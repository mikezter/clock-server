// panel-climate: shows temperature and humidity from SwitchBot meters on the
// Obegränsad panel for one minute every 15 minutes, alternating every 15 s.
//
// The meters' BLE advertisements are read through BlueZ (D-Bus, no pairing).
// The last good reading is cached; missing values show as "--". The frame goes
// to the Worker as the free drawing (image 12); afterwards the previous panel
// state is restored, unless someone changed the panel in the meantime.
//
// SIGUSR1 (systemctl --user reload panel-climate) shows the cached values now.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
)

var (
	worker  = flag.String("worker", "https://clock-server.mikezter.workers.dev", "Worker base URL")
	sensors = flag.String("sensors", "E0:A3:40:DB:F7:3C,D7:35:34:35:17:7E", "SwitchBot meter MACs; the n-th gets dot n bottom left (living room, freezer)")
	adapter = flag.String("adapter", "", "Bluetooth adapter, e.g. hci0 (default: the first one)")
	every   = flag.Duration("every", 15*time.Minute, "show interval, aligned to the wall clock")
	showFor = flag.Duration("show", time.Minute, "how long the values stay on the panel")
	flip    = flag.Duration("flip", 15*time.Second, "switch to the next sensor this often while showing")
	scanIv  = flag.Duration("scan-every", 5*time.Minute, "how often to listen for the meters")
	scanFor = flag.Duration("scan-for", 30*time.Second, "max listening time per scan")
	staleAt = flag.Duration("stale", time.Hour, "readings older than this get a dot bottom right")
	print1  = flag.Bool("print", false, "scan once, print the frames, exit (does not touch the panel)")
	token   = os.Getenv("PANEL_TOKEN") // optional X-Token for /set
)

type reading struct {
	temp float64
	hum  int
	at   time.Time
}

var (
	macs []string
	mu   sync.Mutex
	last = map[string]reading{} // by MAC; absent = never seen
)

func main() {
	flag.Parse()
	log.SetFlags(0)
	for _, m := range strings.Split(*sensors, ",") {
		macs = append(macs, strings.ToUpper(strings.TrimSpace(m)))
	}

	if *print1 {
		scan()
		for i := range macs {
			fmt.Println(macs[i])
			for _, row := range frame(i) {
				fmt.Println(strings.NewReplacer("0", " .", "1", " #").Replace(fmt.Sprintf("%016b", row)))
			}
		}
		return
	}

	go func() {
		for {
			scan()
			time.Sleep(*scanIv)
		}
	}()

	force := make(chan os.Signal, 1)
	signal.Notify(force, syscall.SIGUSR1)
	for {
		next := time.Now().Truncate(*every).Add(*every)
		select {
		case <-time.After(time.Until(next)):
		case <-force:
			log.Print("forced")
		}
		show()
	}
}

// ---------- BLE ----------

// scan listens until every meter was heard once or scanFor runs out, and
// updates the cache with what arrived; unheard meters keep their last value.
// Only data received during the window counts, so BlueZ's cache never leaks
// stale values in. A private bus connection per scan: discovery stops by itself
// when it closes, and a restarted bluetoothd is no problem.
func scan() {
	conn, err := dbus.ConnectSystemBus()
	if err != nil {
		log.Print("dbus: ", err)
		return
	}
	defer conn.Close()

	hci := *adapter
	if hci == "" {
		var objs map[dbus.ObjectPath]map[string]map[string]dbus.Variant
		conn.Object("org.bluez", "/").Call("org.freedesktop.DBus.ObjectManager.GetManagedObjects", 0).Store(&objs)
		for p, ifs := range objs {
			if _, ok := ifs["org.bluez.Adapter1"]; ok {
				hci = strings.TrimPrefix(string(p), "/org/bluez/")
				break
			}
		}
	}
	ad := conn.Object("org.bluez", dbus.ObjectPath("/org/bluez/"+hci))
	ad.Call("org.bluez.Adapter1.SetDiscoveryFilter", 0, map[string]dbus.Variant{
		"Transport":     dbus.MakeVariant("le"),
		"DuplicateData": dbus.MakeVariant(true),
	})

	byPath := map[dbus.ObjectPath]string{}
	for _, m := range macs {
		p := dbus.ObjectPath("/org/bluez/" + hci + "/dev_" + strings.ReplaceAll(m, ":", "_"))
		byPath[p] = m
		conn.AddMatchSignal(dbus.WithMatchObjectPath(p), dbus.WithMatchMember("PropertiesChanged"))
		// Drop BlueZ's cached entry of the (never paired) meter: it would only
		// report changed values. Re-added, every advertisement is InterfacesAdded.
		ad.Call("org.bluez.Adapter1.RemoveDevice", 0, p)
	}
	conn.AddMatchSignal(dbus.WithMatchMember("InterfacesAdded"))
	sig := make(chan *dbus.Signal, 64)
	conn.Signal(sig)

	if err := ad.Call("org.bluez.Adapter1.StartDiscovery", 0).Err; err != nil {
		log.Print("bluez: ", err)
		return
	}
	defer ad.Call("org.bluez.Adapter1.StopDiscovery", 0)

	heard := map[string]bool{}
	timeout := time.After(*scanFor)
	for len(heard) < len(macs) {
		select {
		case <-timeout:
			for _, m := range macs {
				if !heard[m] {
					log.Printf("%s: not heard within %v, keeping last value", m, *scanFor)
				}
			}
			return
		case s := <-sig:
			var props map[string]dbus.Variant
			var path dbus.ObjectPath
			switch {
			case s.Name == "org.freedesktop.DBus.Properties.PropertiesChanged" && len(s.Body) >= 2:
				path = s.Path
				props, _ = s.Body[1].(map[string]dbus.Variant)
			case s.Name == "org.freedesktop.DBus.ObjectManager.InterfacesAdded" && len(s.Body) >= 2:
				path, _ = s.Body[0].(dbus.ObjectPath)
				ifs, _ := s.Body[1].(map[string]map[string]dbus.Variant)
				props = ifs["org.bluez.Device1"]
			}
			m, mine := byPath[path]
			if r, ok := parse(props); mine && ok && !heard[m] {
				heard[m] = true
				mu.Lock()
				last[m] = r
				mu.Unlock()
				log.Printf("%s: %.1f °C, %d %%", m, r.temp, r.hum)
			}
		}
	}
}

// parse decodes a SwitchBot meter advertisement (same layout as pySwitchbot):
// manufacturer data 0x0969 bytes 8..10, or service data fd3d bytes 3..5.
func parse(props map[string]dbus.Variant) (reading, bool) {
	var t []byte
	if m, ok := props["ManufacturerData"].Value().(map[uint16]dbus.Variant); ok {
		if b, ok := m[0x0969].Value().([]byte); ok && len(b) >= 11 {
			t = b[8:11]
		}
	}
	if s, ok := props["ServiceData"].Value().(map[string]dbus.Variant); ok && t == nil {
		if b, ok := s["0000fd3d-0000-1000-8000-00805f9b34fb"].Value().([]byte); ok && len(b) >= 6 {
			t = b[3:6]
		}
	}
	if t == nil {
		return reading{}, false
	}
	temp := float64(t[1]&0x7f) + float64(t[0]&0x0f)/10
	if t[1]&0x80 == 0 {
		temp = -temp
	}
	return reading{temp, int(t[2] & 0x7f), time.Now()}, true
}

// ---------- Rendering ----------

var font = map[rune][]string{
	'0': {"###", "#.#", "#.#", "#.#", "###"},
	'1': {".#.", "##.", ".#.", ".#.", "###"},
	'2': {"###", "..#", "###", "#..", "###"},
	'3': {"###", "..#", ".##", "..#", "###"},
	'4': {"#.#", "#.#", "###", "..#", "..#"},
	'5': {"###", "#..", "###", "..#", "###"},
	'6': {"###", "#..", "###", "#.#", "###"},
	'7': {"###", "..#", ".#.", ".#.", ".#."},
	'8': {"###", "#.#", "###", "#.#", "###"},
	'9': {"###", "#.#", "###", "..#", "###"},
	'-': {"...", "...", "###", "...", "..."},
	'.': {".", ".", ".", ".", "#"},
	'°': {"##", "##", "..", "..", ".."},
	'%': {"#.#", "..#", ".#.", "#..", "#.#"},
}

func width(s string) int {
	w := -1
	for _, c := range s {
		w += len(font[c][0]) + 1
	}
	return w
}

// text draws s centered horizontally, glyph top at row y.
func text(rows *[16]uint16, s string, y int) {
	x := (16 - width(s)) / 2
	for _, c := range s {
		g := font[c]
		for dy, line := range g {
			for dx, px := range line {
				if px == '#' && x+dx >= 0 && x+dx < 16 {
					rows[y+dy] |= 1 << (15 - (x + dx)) // MSB = leftmost pixel
				}
			}
		}
		x += len(g[0]) + 1
	}
}

// frame renders sensor i: temperature on top, humidity below, dot i+1 of
// the row bottom left says which sensor it is (every other pixel).
func frame(i int) [16]uint16 {
	mu.Lock()
	r, ok := last[macs[i]]
	mu.Unlock()

	t, h := "--.-°", "--%"
	if ok {
		t = fmt.Sprintf("%.1f°", r.temp)
		if width(t) > 16 { // e.g. -12.5° does not fit, -12° does
			t = fmt.Sprintf("%.0f°", r.temp)
		}
		h = fmt.Sprintf("%d%%", r.hum)
	}
	var rows [16]uint16
	text(&rows, t, 2)
	text(&rows, h, 9)
	rows[15] |= 1 << (15 - 2*i)
	if ok && time.Since(r.at) > *staleAt {
		rows[15] |= 1 // old value: one dot bottom right
	}
	return rows
}

// ---------- Worker ----------

var client = &http.Client{Timeout: 10 * time.Second}

func call(method, path string, body any) (string, error) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, *worker+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("X-Token", token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("%s %s: %s", method, path, resp.Status)
	}
	return strings.TrimSpace(string(b)), nil
}

// show puts the frames on the panel for showFor, then restores what was there.
func show() {
	prev, err := call("GET", "/state", nil)
	if err != nil {
		log.Print("worker: ", err)
		return
	}
	// The drawing slot is shared: keep the user's drawing if it is on screen.
	var drawing []int
	if strings.HasPrefix(prev, "12") {
		if s, err := call("GET", "/custom", nil); err == nil {
			for _, f := range strings.Fields(s) {
				v, _ := strconv.Atoi(f)
				drawing = append(drawing, v)
			}
		}
	}

	// Cycle through the sensors. Before each step make sure the panel still
	// shows our last frame; if someone changed it (button, web page), stop.
	mine := ""
	for k := 0; time.Duration(k)**flip < *showFor; k++ {
		if k > 0 {
			if now, err := call("GET", "/state", nil); err != nil || now != mine {
				log.Printf("panel changed meanwhile (%q), leaving it", now)
				return
			}
		}
		rows := frame(k % len(macs))
		if _, err := call("POST", "/custom", map[string]any{"rows": rows}); err != nil {
			log.Print("worker: ", err)
			if k == 0 {
				return
			}
		}
		mine, _ = call("GET", "/state", nil) // "12 <rev>"
		if k == 0 {
			log.Printf("shown (was %q)", prev)
		}
		time.Sleep(min(*flip, *showFor-time.Duration(k)**flip))
	}

	now, err := call("GET", "/state", nil)
	if err != nil || now != mine {
		log.Printf("panel changed meanwhile (%q), leaving it", now)
		return
	}
	switch {
	case prev == "0":
		_, err = call("POST", "/reset", nil)
	case len(drawing) == 16:
		_, err = call("POST", "/custom", map[string]any{"rows": drawing})
	case strings.HasPrefix(prev, "12"): // drawing could not be saved
		_, err = call("POST", "/reset", nil)
	default:
		img, _ := strconv.Atoi(prev)
		_, err = call("POST", "/set", map[string]any{"img": img, "ttl": 60})
	}
	if err != nil {
		log.Print("worker: restore failed: ", err)
	}
}
