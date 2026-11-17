import fs from "fs";
const src = fs.readFileSync("sortie.js", "utf8");
const a = src.indexOf("const BRF = `"), b = src.indexOf("async function brProfile");
const BRF_STRICT = new Function(src.slice(a, b) + "; return BRF_STRICT;")();
const UA = { "User-Agent": "BreizhWatts/1.0 (https://nathanlr29.github.io/Garmin/)" };
const BR = "https://brouter.de/brouter";
const pr = await (await fetch(BR + "/profile", { method: "POST", body: BRF_STRICT, headers: UA })).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = [48.1173, -1.6778], A = [47.3655, -1.1770];
const CG=[47.8286,-0.7030], SG=[47.6860,-0.8720];
const V = {
  cg_aller: [R,[47.957,-1.499],[47.913,-1.380],[47.848,-0.950],CG],
  cg_retour: [CG,[47.945,-0.913],[47.942,-1.231],[48.070,-1.390],R],
  sg_aller: [R,[47.957,-1.499],[47.831,-1.317],[47.740,-1.170],SG],
  sg_retour: [SG,[47.848,-0.950],[47.942,-1.231],[48.046,-1.504],R],
};
const out = {};
for (const [k, wps] of Object.entries(V)) {
  const ll = wps.map(p => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join("|");
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${BR}?lonlats=${ll}&profile=${pr.profileid}&format=geojson`, { headers: UA });
    if (r.ok) { const f = (await r.json()).features[0]; out[k] = { km: +f.properties["track-length"] / 1000, up: +f.properties["filtered ascend"], c: f.geometry.coordinates, msgs: f.properties.messages }; console.log(k, out[k].km, out[k].up); break; }
    console.log(k, r.status); await sleep(8000);
  }
  await sleep(800);
}
fs.writeFileSync("tmp2/out2.json", JSON.stringify(out));
