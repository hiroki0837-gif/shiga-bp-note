/* 血圧ノート＠しが Service Worker
   役割：一度開いたことのある画面を、圏外でも開けるようにする（アプリの殻だけ）。
   記録はもともと端末内（localStorage）なので、開きさえすれば入力・閲覧は通信なしで動く。
   画面はネット優先（最新版を取りにいき、成功したら控えを更新）。圏外のときだけ控えを出す。 */
const CACHE = "bp-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 画面そのもの：ネット優先。?u= などのクエリは無視してパスごとに控える
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const c = await caches.open(CACHE);
          c.put(url.pathname, res.clone());
        }
        return res;
      } catch {
        const hit = await caches.match(url.pathname);
        if (hit) return hit;
        return new Response(
          "<meta charset='utf-8'><body style='font-family:sans-serif;padding:40px 20px;text-align:center'>" +
          "<h2>通信できません</h2><p>電波のある場所で、もう一度開いてください。<br>記録は消えていません。</p></body>",
          { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
        );
      }
    })());
    return;
  }

  // ビルド済みアセットとアイコン：ファイル名にハッシュが入るので、控えがあればそれを使う
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icon") ||
      url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.svg" ||
      url.pathname === "/apple-touch-icon.png") {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    })());
  }
});
