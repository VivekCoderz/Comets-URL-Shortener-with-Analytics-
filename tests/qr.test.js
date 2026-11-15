import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Tests for the QR code (PRD FR-10, board task CMT-38):
// the shared rules in lib/qr.js, and GET/PUT /api/links/[id]/qr.
// Same approach as tests/link-edit.test.js: real MongoDB, fake cookie jar.

const cookieJar = new Map();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name, value) => cookieJar.set(name, value),
    delete: (name) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const qr = await import("@/lib/qr");
const { connectDB } = await import("@/lib/db");
const { createToken, AUTH_COOKIE } = await import("@/lib/auth");
const { UserModel } = await import("@/models/User");
const { LinkModel } = await import("@/models/Link");
const { QrLogoModel } = await import("@/models/QrLogo");
const { GET, PUT } = await import("@/app/api/links/[id]/qr/route");
const { GET: GET_LOGO } = await import("@/app/api/links/[id]/qr/logo/route");

describe("lib/qr.js rules", () => {
  it("encodes the short URL with ?src=qr", () => {
    expect(qr.qrUrlFor("https://comets.app/geeta-fest")).toBe("https://comets.app/geeta-fest?src=qr");
  });

  it("names the file qr-<code>.png", () => {
    expect(qr.qrFilename("geeta-fest")).toBe("qr-geeta-fest.png");
  });

  it("measures contrast like WCAG", () => {
    expect(qr.contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(qr.contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(qr.hasEnoughContrast("#000000", "#ffffff")).toBe(true);
    expect(qr.hasEnoughContrast("#ffff99", "#ffffff")).toBe(false); // light yellow on white (PRD example)
  });

  it("uses whole-pixel modules, fits the image, and keeps the logo patch within the area limit", () => {
    for (const size of qr.QR_SIZE_PRESETS) {
      for (const moduleCount of [29, 37, 45]) {
        const layout = qr.qrLayout(size, moduleCount);
        expect(Number.isInteger(layout.scale)).toBe(true);
        expect(layout.offset * 2 + layout.drawnSize).toBeLessThanOrEqual(size);
        const codeSize = moduleCount * layout.scale;
        expect(layout.patchSize ** 2 / codeSize ** 2).toBeLessThanOrEqual(qr.LOGO_MAX_AREA);
      }
    }
  });

  it("accepts sizes 128–1024 only", () => {
    expect(qr.qrSizeSchema.parse(undefined)).toBe(512);
    expect(qr.qrSizeSchema.parse("128")).toBe(128);
    expect(qr.qrSizeSchema.safeParse("127").success).toBe(false);
    expect(qr.qrSizeSchema.safeParse("1025").success).toBe(false);
    expect(qr.qrSizeSchema.safeParse("abc").success).toBe(false);
  });

  it("accepts only #rrggbb colours", () => {
    expect(qr.hexColorSchema.parse("#FF00aa")).toBe("#ff00aa");
    expect(qr.hexColorSchema.safeParse("red").success).toBe(false);
    expect(qr.hexColorSchema.safeParse("#fff").success).toBe(false);
  });
});

// ---- Route tests (real database) ---------------------------------------------

const tag = randomUUID().slice(0, 8);
let owner, stranger, link;

const ctx = (id) => ({ params: Promise.resolve({ id: String(id) }) });

async function loginAs(user) {
  cookieJar.set(AUTH_COOKIE, await createToken(user._id));
}

async function getQr(id, query = "") {
  return GET(new Request(`http://localhost:3000/api/links/${id}/qr${query}`), ctx(id));
}

async function putQr(id, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const res = await PUT(new Request(`http://localhost:3000/api/links/${id}/qr`, { method: "PUT", body: form }), ctx(id));
  return { res, body: await res.json() };
}

// A small red square PNG to use as a logo.
async function makeLogo() {
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff0000" } }).png().toBuffer();
  return new File([bytes], "logo.png", { type: "image/png" });
}

beforeAll(async () => {
  await connectDB();
  owner = await UserModel.create({ email: `qr-owner-${tag}@comets-test.dev`, passwordHash: "x" });
  stranger = await UserModel.create({ email: `qr-stranger-${tag}@comets-test.dev`, passwordHash: "x" });
  link = await LinkModel.create({
    userId: owner._id,
    code: `qr${tag}`,
    longUrl: "https://example.com/qr",
    createdVia: "dashboard",
  });
});

afterAll(async () => {
  await QrLogoModel.deleteMany({ linkId: link._id });
  await LinkModel.deleteMany({ _id: link._id });
  await UserModel.deleteMany({ _id: { $in: [owner._id, stranger._id] } });
});

describe("GET /api/links/[id]/qr", () => {
  it("needs login", async () => {
    cookieJar.clear();
    expect((await getQr(link._id)).status).toBe(401);
  });

  it("is 404 for someone else's link", async () => {
    await loginAs(stranger);
    expect((await getQr(link._id)).status).toBe(404);
  });

  it("downloads a PNG of the chosen size named qr-<code>.png", async () => {
    await loginAs(owner);
    const res = await getQr(link._id, "?size=256");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain(`qr-${link.code}.png`);
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it("rejects sizes outside 128–1024", async () => {
    await loginAs(owner);
    expect((await getQr(link._id, "?size=2000")).status).toBe(400);
  });
});

describe("PUT /api/links/[id]/qr", () => {
  it("blocks low contrast with LOW_CONTRAST", async () => {
    await loginAs(owner);
    const { res, body } = await putQr(link._id, { fgColor: "#ffff99", bgColor: "#ffffff" });
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("LOW_CONTRAST");
  });

  it("rejects a logo that is not a PNG/JPG", async () => {
    await loginAs(owner);
    const fake = new File(["not an image"], "logo.png", { type: "image/png" });
    const { res } = await putQr(link._id, { fgColor: "#000000", bgColor: "#ffffff", logo: fake });
    expect(res.status).toBe(400);
  });

  it("rejects a logo over 1 MB", async () => {
    await loginAs(owner);
    const big = new File([new Uint8Array(qr.LOGO_MAX_BYTES + 1)], "big.png", { type: "image/png" });
    const { res } = await putQr(link._id, { fgColor: "#000000", bgColor: "#ffffff", logo: big });
    expect(res.status).toBe(400);
  });

  it("saves colours and logo, serves the logo, then removes it", async () => {
    await loginAs(owner);
    const { res, body } = await putQr(link._id, { fgColor: "#1E3A8A", bgColor: "#ffffff", logo: await makeLogo() });
    expect(res.status).toBe(200);
    expect(body.qrStyle).toEqual({
      fgColor: "#1e3a8a",
      bgColor: "#ffffff",
      logoUrl: `/api/links/${link._id}/qr/logo`,
    });

    const logoRes = await GET_LOGO(new Request("http://localhost:3000/"), ctx(link._id));
    expect(logoRes.status).toBe(200);
    expect(logoRes.headers.get("content-type")).toBe("image/png");

    // The download now has the logo in the middle: the centre pixel is red.
    const png = Buffer.from(await (await getQr(link._id, "?size=512")).arrayBuffer());
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const centre = (256 * info.width + 256) * info.channels;
    expect([data[centre], data[centre + 1], data[centre + 2]]).toEqual([255, 0, 0]);

    const removed = await putQr(link._id, { fgColor: "#1e3a8a", bgColor: "#ffffff", removeLogo: "true" });
    expect(removed.body.qrStyle.logoUrl).toBeNull();
    expect(await QrLogoModel.countDocuments({ linkId: link._id })).toBe(0);
  });

  it("is 404 for someone else's link", async () => {
    await loginAs(stranger);
    const { res } = await putQr(link._id, { fgColor: "#000000", bgColor: "#ffffff" });
    expect(res.status).toBe(404);
  });
});
