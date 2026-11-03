import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "http://example.com";
const post = (path, body) =>
	SELF.fetch(BASE + path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
const text = async (path) => (await SELF.fetch(BASE + path)).text();

describe("clock-server", () => {
	it("starts in clock mode with an empty drawing", async () => {
		expect(await text("/state")).toBe("0");
		expect(await text("/custom")).toBe(new Array(16).fill(0).join("\n"));
	});

	it("/set shows an image, /reset returns to the clock", async () => {
		const r = await post("/set", { img: 3, ttl: 0 });
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ img: 3, expiresAt: null });
		expect(await text("/state")).toBe("3");
		await post("/reset");
		expect(await text("/state")).toBe("0");
	});

	it("an expired image reverts to the clock", async () => {
		const now = Date.now();
		await post("/set", { img: 5, ttl: 60 });
		expect(await text("/state")).toBe("5");
		const realNow = Date.now;
		Date.now = () => now + 61_000;
		try {
			expect(await text("/state")).toBe("0");
		} finally {
			Date.now = realNow;
		}
	});

	it("POST /custom stores the rows and switches to image 12", async () => {
		const rows = Array.from({ length: 16 }, (_, i) => (i * 4099) & 0xffff);
		expect((await post("/custom", { rows })).status).toBe(200);
		expect(await text("/custom")).toBe(rows.join("\n"));
		const first = await text("/state");
		expect(first).toMatch(/^12 \d+$/);
		// a new drawing bumps the revision, re-showing the same one does not
		expect(await text("/state")).toBe(first);
		await post("/custom", { rows });
		expect(await text("/state")).not.toBe(first);
	});

	it("GET /img/<id> serves library bitmaps and the drawing", async () => {
		for (const id of [1, 2, 3, 4, 5, 6, 7]) {
			const rows = (await text("/img/" + id)).split("\n");
			expect(rows).toHaveLength(16);
			expect(rows.every((v) => /^\d+$/.test(v) && Number(v) <= 65535)).toBe(true);
		}
		// test pattern: full top edge, border on the rest
		expect((await text("/img/1")).split("\n")[0]).toBe("65535");
		// 12 mirrors /custom
		const rows = Array.from({ length: 16 }, (_, i) => (i * 257) & 0xffff);
		await post("/custom", { rows });
		expect(await text("/img/12")).toBe(rows.join("\n"));
		for (const id of [0, 8, 9, 10, 11, 13, 99]) {
			expect((await SELF.fetch(BASE + "/img/" + id)).status).toBe(404);
		}
	});

	it("rejects bad input", async () => {
		expect((await post("/custom", { rows: [1, 2, 3] })).status).toBe(400);
		expect((await post("/custom", { rows: new Array(16).fill(70000) })).status).toBe(400);
		const bad = await SELF.fetch(BASE + "/set", { method: "POST", body: "{" });
		expect(bad.status).toBe(400);
		expect((await SELF.fetch(BASE + "/nope")).status).toBe(404);
	});

	it("serves the pages", async () => {
		for (const p of ["/", "/draw"]) {
			const r = await SELF.fetch(BASE + p);
			expect(r.status).toBe(200);
			expect(r.headers.get("Content-Type")).toContain("text/html");
		}
	});
});
