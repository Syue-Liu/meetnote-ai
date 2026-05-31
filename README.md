# MeetNote AI

手機可用的 AI 會議逐字稿 PWA 原型。

## 本機預覽

```bash
python3 -m http.server 4173
```

打開：

```text
http://127.0.0.1:4173
```

## 出門也能用

把整個資料夾部署到支援 HTTPS 的靜態網站服務即可，例如 GitHub Pages、Netlify、Vercel 或 Cloudflare Pages。

手機錄音/語音辨識通常需要 HTTPS，部署後請用 `https://...` 的網址開啟。

## 手機安裝

1. 用手機瀏覽器打開部署後的 HTTPS 網址。
2. iPhone：分享 > 加入主畫面。
3. Android：選單 > 安裝應用程式。

安裝後可以從主畫面開啟，頁面檔案會離線快取，會議資料會存在手機本機瀏覽器。

## 目前功能

- 開始/停止錄音，停止後新增一筆可播放、可下載的錄音檔
- 手動新增逐字稿
- 講者新增與編輯
- 決策/待辦篩選
- 摘要與 Markdown 匯出
- PWA 安裝與離線快取
