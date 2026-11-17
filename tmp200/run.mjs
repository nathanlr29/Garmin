// Temporaire : météo de samedi + boucles de 200 km (BRouter, profil strict du site). Supprimé avant toute PR.
import fs from "fs";
const src = fs.readFileSync("sortie.js", "utf8");
const a = src.indexOf("const BRF = `"), b = src.indexOf("async function brProfile");
const BRF_STRICT = new Function(src.slice(a, b) + "; return BRF_STRICT;")();
const UA = { "User-Agent": "BreizhWatts/1.0 (https://nathanlr29.github.io/Garmin/)" };
const out = { wx: {}, loops: [] };
const S = [48.1173, -1.6778], rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
function dest(p, br, km) { const d = km / 6371, la = rad(p[0]), lo = rad(p[1]), t = rad(br);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t));
  return [deg(la2), deg(lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2)))]; }
// Météo : Rennes + 8 points à 55 km
const pts = [["Rennes", S], ...[0,45,90,135,180,225,270,315].map(t => [`${t}°`, dest(S, t, 55)])];
const H = "temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,cloud_cover";
for (const [n, p] of pts) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${p[0].toFixed(2)}&longitude=${p[1].toFixed(2)}&hourly=${H}&daily=sunrise,sunset&start_date=2026-11-20&end_date=2026-11-22&timezone=Europe%2FParis`;
  try { out.wx[n] = await (await fetch(u)).json(); } catch (e) { out.wx[n] = String(e); }
  if (n === "Rennes") for (const m of ["ecmwf_ifs025", "gfs_seamless", "icon_seamless", "meteofrance_seamless"]) {
    try { out.wx["Rennes_" + m] = await (await fetch(u + "&models=" + m)).json(); } catch (e) { out.wx["Rennes_" + m] = String(e); }
  }
}
// Boucles
const BR = "https://brouter.de/brouter";
const pr = await (await fetch(BR + "/profile", { method: "POST", body: BRF_STRICT, headers: UA })).json();
console.log("profil", pr);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function route(wps, alt = 0) {
  const ll = [S, ...wps, S].map(p => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join("|");
  for (let k = 0; k < 4; k++) {
    const r = await fetch(`${BR}?lonlats=${ll}&profile=${pr.profileid}&alternativeidx=${alt}&format=geojson`, { headers: UA });
    if (r.ok) { const f = (await r.json()).features[0]; return { km: +f.properties["track-length"] / 1000, up: +f.properties["filtered ascend"], c: f.geometry.coordinates, msgs: f.properties.messages }; }
    console.log("BR", r.status, (await r.text()).slice(0, 100)); await sleep(8000);
  }
  return null;
}
for (const t of [0, 45, 90, 135, 180, 225, 270, 315]) {
  for (const spread of [40, 55]) {
    let R = 60, res = null;
    for (let i = 0; i < 3; i++) {
      const wps = [dest(S, t - spread, R * .78), dest(S, t, R), dest(S, t + spread, R * .78)];
      res = await route(wps); await sleep(700);
      if (!res) break;
      console.log(t, spread, R.toFixed(1), res.km.toFixed(1), res.up);
      if (Math.abs(res.km - 200) < 8) { res.wps = wps; break; }
      R *= Math.pow(200 / res.km, .9); res.wps = wps;
    }
    if (res) out.loops.push({ t, spread, R, ...res });
  }
}
fs.writeFileSync("tmp200/out.json", JSON.stringify(out));
