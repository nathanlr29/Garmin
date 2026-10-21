// Animation de démarrage (2,6 s, une fois par session d'onglet) : le cercle de départ du logo apparaît en Finistère,
// le tracé fait le tour de la Bretagne (nord puis sud), une étoile scintille sur Rennes et devient le point blanc,
// on passe sur la vraie icône (icon-512.png) puis la plaque orange se pose sur l'icône de la barre d'application.
// Un clic ou une touche passe directement à la fin. Rien si « réduire les animations » est demandé.
(() => {
  "use strict";
  const KEY = "splashSeen";
  try { if (sessionStorage.getItem(KEY)) return; sessionStorage.setItem(KEY, "1"); } catch (e) {}
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Tracé repris de icon-512.png (repère 512 × 512), départ au cercle du Finistère, sens des aiguilles d'une montre
  const COAST = "M61.0 199.5 L61.5 197.0 L66.0 194.5 L76.0 192.5 L79.5 189.0 L81.0 185.5 L95.0 182.5 L102.0 177.5 L106.0 177.5 L113.0 180.5 L116.0 179.5 L120.0 175.5 L130.0 175.5 L137.0 172.5 L141.0 169.5 L142.5 170.0 L143.5 175.0 L146.0 177.5 L149.0 178.5 L153.0 177.5 L159.0 172.5 L160.0 173.5 L175.0 173.5 L178.0 174.5 L181.0 173.5 L184.5 170.0 L185.5 167.0 L184.5 159.0 L188.0 156.5 L191.0 152.5 L196.0 153.5 L201.0 156.5 L211.0 151.5 L219.0 150.5 L222.0 147.5 L228.0 149.5 L235.0 146.5 L239.0 152.5 L244.5 154.0 L245.5 160.0 L249.0 163.5 L251.0 163.5 L252.5 165.0 L253.5 171.0 L264.5 181.0 L265.5 189.0 L270.0 193.5 L275.0 195.5 L278.0 199.5 L281.0 200.5 L285.0 199.5 L293.0 190.5 L298.0 188.5 L300.5 186.0 L302.0 181.5 L306.0 181.5 L307.0 182.5 L319.0 177.5 L328.0 187.5 L331.0 188.5 L334.0 187.5 L337.0 183.5 L341.0 183.5 L348.0 181.5 L353.0 176.5 L357.0 174.5 L364.0 173.5 L368.5 176.0 L366.5 181.0 L367.5 184.0 L370.0 186.5 L375.0 188.5 L383.0 187.5 L384.0 186.5 L389.0 186.5 L390.0 185.5 L396.0 185.5 L397.0 184.5 L402.5 193.0 L402.5 196.0 L401.5 197.0 L404.5 204.0 L407.0 206.5 L409.0 206.5 L413.0 210.5 L416.0 211.5 L419.0 210.5 L429.0 199.5 L432.0 198.5 L438.0 198.5 L450.0 203.5 L449.5 218.0 L450.5 219.0 L452.5 233.0 L448.5 239.0 L447.5 247.0 L448.5 248.0 L451.5 266.0 L455.5 275.0 L455.5 284.0 L454.0 285.5 L446.0 286.5 L441.5 290.0 L432.5 318.0 L430.0 319.5 L426.0 317.5 L420.0 316.5 L416.0 312.5 L413.0 311.5 L410.0 312.5 L407.0 315.5 L395.0 320.5 L390.5 325.0 L389.5 328.0 L387.0 330.5 L384.0 331.5 L372.0 331.5 L371.0 330.5 L368.0 330.5 L361.0 333.5 L357.0 336.5 L356.0 335.5 L349.0 336.5 L342.5 341.0 L341.5 344.0 L341.5 357.0 L335.5 362.0 L334.0 364.5 L328.0 363.5 L321.0 365.5 L318.0 369.5 L313.0 369.5 L312.0 370.5 L306.0 369.5 L302.0 371.5 L299.5 370.0 L298.5 365.0 L295.0 361.5 L285.0 360.5 L280.0 363.5 L277.0 363.5 L276.0 362.5 L269.0 365.5 L266.0 365.5 L263.0 364.5 L252.0 352.5 L249.0 351.5 L248.0 352.5 L245.0 352.5 L241.0 350.5 L237.0 351.5 L233.5 355.0 L232.5 359.0 L235.5 366.0 L232.0 367.5 L230.5 365.0 L230.5 352.0 L229.5 349.0 L215.0 331.5 L207.0 330.5 L201.0 332.5 L199.0 331.5 L198.0 332.5 L190.0 322.5 L183.0 320.5 L173.0 319.5 L170.0 316.5 L167.0 315.5 L163.0 317.5 L158.0 317.5 L153.0 313.5 L148.0 307.5 L145.0 306.5 L139.0 308.5 L135.0 308.5 L133.0 306.5 L129.0 305.5 L126.0 306.5 L123.5 309.0 L120.0 315.5 L102.0 316.5 L100.5 315.0 L100.5 312.0 L102.5 307.0 L95.5 291.0 L87.0 284.5 L79.0 283.5 L72.0 279.5 L66.0 279.5 L64.5 275.0 L66.0 273.5 L74.0 272.5 L79.0 270.5 L88.0 269.5 L89.0 268.5 L98.0 267.5 L99.0 266.5 L101.0 267.5 L106.0 266.5 L108.5 264.0 L109.5 261.0 L107.5 255.0 L104.0 251.5 L91.0 246.5 L88.0 247.5 L84.5 251.0 L82.5 255.0 L80.5 256.0 L80.5 249.0 L79.5 246.0 L76.5 243.0 L79.5 237.0 L78.5 234.0 L75.0 230.5 L72.5 230.0 L75.5 222.0 L75.5 215.0 L73.5 209.0 L66.0 201.5 Z";
  const DOT = [386, 265.5, 12.8], START = [55.5, 218.6, 17.5];
  const T = { pop: [0, 220], draw: [120, 1300], star: [1080, 1520], morph: [1520, 1780], png: [1720, 1880], fly: [1880, 2520], end: 2560 };

  const el = document.createElement("div");
  el.id = "splash";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="sp-bg"></div><div class="sp-plate"><svg viewBox="0 0 512 512">
<defs><filter id="spB1" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="spB2" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="14"/></filter></defs>
<g class="sp-vec">
<circle class="sp-start" cx="${START[0]}" cy="${START[1]}" r="0" fill="none" stroke-width="8"/>
<path class="sp-coast" d="${COAST}" fill="none" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>
<g class="sp-head" stroke="none" opacity="0"><circle r="18" opacity=".45" filter="url(#spB1)"/><circle r="8"/></g>
<g transform="translate(${DOT[0]} ${DOT[1]})">
<circle class="sp-glow" r="40" stroke="none" filter="url(#spB2)" opacity="0"/>
<g class="sp-rays" stroke-width="4" stroke-linecap="round" fill="none"></g>
<path class="sp-star" stroke="none" transform="scale(0)" d="M0 -44Q4 -4 44 0Q4 4 0 44Q-4 4 -44 0Q-4 -4 0 -44Z"/>
<path class="sp-star2" stroke="none" transform="scale(0)" d="M0 -22Q2 -2 22 0Q2 2 0 22Q-2 2 -22 0Q-2 -2 0 -22Z"/>
<circle class="sp-dot" stroke="none" r="0"/></g></g>
<image class="sp-png" href="icon-512.png" width="512" height="512" opacity="0"/></svg></div>`;
  document.body.appendChild(el);

  const q = s => el.querySelector(s);
  const bg = q(".sp-bg"), plate = q(".sp-plate"), svg = q("svg"), vec = q(".sp-vec"), png = q(".sp-png"),
        coast = q(".sp-coast"), head = q(".sp-head"), start = q(".sp-start"), star = q(".sp-star"), star2 = q(".sp-star2"),
        dot = q(".sp-dot"), glow = q(".sp-glow"), rays = q(".sp-rays");
  const L = coast.getTotalLength();
  coast.style.strokeDasharray = L; coast.style.strokeDashoffset = L;
  const RAY = [];
  for (let i = 0; i < 8; i++) {
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    rays.appendChild(l); RAY.push([l, i * Math.PI / 4 + Math.PI / 8, i % 2 ? .6 : 1]);
  }

  const clamp = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const seg = (t, [a, b]) => clamp((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ioCubic = x => x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
  const ioQuint = x => x < .5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2;
  const oCubic = x => 1 - (1 - x) ** 3;
  const oBack = x => 1 + 2.9 * (x - 1) ** 3 + 1.9 * (x - 1) ** 2;

  let target = null;   // icône de la barre d'application, mesurée au début du passage
  function frame(t) {
    const p = seg(t, T.pop);
    start.setAttribute("r", START[2] * oBack(p));

    const d = ioCubic(seg(t, T.draw)), len = L * d, hp = coast.getPointAtLength(len);
    coast.style.strokeDashoffset = L - len;
    head.setAttribute("transform", `translate(${hp.x} ${hp.y})`);
    head.setAttribute("opacity", d <= 0 ? 0 : d < 1 ? 1 : 1 - seg(t, [T.draw[1], T.draw[1] + 160]));

    const s = seg(t, T.star), m = ioQuint(seg(t, T.morph));
    const sc = Math.max(0, oBack(s) * (1 - m) + (s > 0 ? Math.sin(t / 55) * .06 * (1 - m) : 0));
    star.setAttribute("transform", `rotate(${lerp(-90, 0, oCubic(s)) + 135 * m}) scale(${sc})`);
    const s2 = Math.max(0, oBack(seg(t, [T.star[0] + 120, T.star[1]])) * (1 - m) * (.8 + .35 * Math.sin(t / 37)));
    star2.setAttribute("transform", `rotate(${45 + lerp(-60, 0, oCubic(s)) - 90 * m}) scale(${s2})`);
    glow.setAttribute("opacity", (s > 0 ? .55 * oCubic(s) : 0) * (1 - m) + .18 * m * (1 - seg(t, T.png)));
    const rk = seg(t, [T.star[0] + 80, T.star[1] + 120]);
    for (const [l, a, k] of RAY) {
      const r0 = lerp(30, 70, oCubic(rk)) * k, r1 = r0 + lerp(18, 4, rk) * k;
      l.setAttribute("x1", Math.cos(a) * r0); l.setAttribute("y1", Math.sin(a) * r0);
      l.setAttribute("x2", Math.cos(a) * r1); l.setAttribute("y2", Math.sin(a) * r1);
      l.setAttribute("opacity", rk > 0 && rk < 1 ? 1 - rk : 0);
    }
    dot.setAttribute("r", DOT[2] * oBack(m));

    const g = seg(t, T.png);
    png.setAttribute("opacity", g); vec.setAttribute("opacity", 1 - g);

    const W = innerWidth, H = innerHeight, fr = seg(t, T.fly);
    if (fr > 0 && !target) {
      const r = document.querySelector(".brand img")?.getBoundingClientRect();
      target = r && r.width && r.bottom > 0 ? { x: r.left, y: r.top, w: r.width } : { x: W / 2 - 14, y: H / 2 - 14, w: 28, fade: 1 };
    }
    const tg = target || { x: 0, y: 0, w: W };
    const f = ioQuint(fr), fs = oCubic(fr), pw = lerp(W, tg.w, fs), ph = lerp(H, tg.w, fs);
    plate.style.cssText = `left:${lerp(0, tg.x, f)}px;top:${lerp(0, tg.y, f)}px;width:${pw}px;height:${ph}px;border-radius:${Math.min(pw, ph) * .21 * fs}px`;
    const ls = lerp(Math.min(W, H) * .92, tg.w, fs);
    svg.style.cssText = `width:${ls}px;height:${ls}px;left:${(pw - ls) / 2}px;top:${(ph - ls) / 2}px`;
    bg.style.opacity = 1 - f;
    if (tg.fade) plate.style.opacity = 1 - f;
  }

  // Horloge propre : chaque image avance de 34 ms au plus, pour que le chargement des données (qui bloque la page)
  // ralentisse l'animation au lieu d'en sauter le début
  let t = 0, last = 0;
  const tick = now => {
    t = Math.min(t + (last ? Math.min(now - last, 34) : 0), T.end); last = now;
    frame(t);
    if (t < T.end) requestAnimationFrame(tick); else el.remove();
  };
  // Clic ou touche : on saute au passage vers l'appli
  const jump = () => { if (t < T.fly[0]) t = T.fly[0]; };
  el.addEventListener("click", jump);
  addEventListener("keydown", jump, { once: true });
  frame(0);
  requestAnimationFrame(tick);
})();
