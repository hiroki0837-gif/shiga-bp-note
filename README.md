# 血圧ノート＠しが

家庭で測った血圧を記録し、受診時にQRコードで医療機関に渡せる手帳アプリです。
記録は端末の中だけに保存され、外部に送信されません。

作成　滋賀医科大学医学部附属病院　循環器内科

## 画面

公開先： **https://shiga-bp-note.vercel.app/**

| URL | 内容 |
| --- | --- |
| https://shiga-bp-note.vercel.app/ | 患者用アプリ（記録・教材・受診用QR・医療者モード） |
| https://shiga-bp-note.vercel.app/?kiosk=1 | 患者用アプリを受付端末として起動 |
| https://shiga-bp-note.vercel.app/terminal.html | 受付端末（血圧ノート＠しがと心不全手帳の両方のQRを読み取り） |
| https://shiga-bp-note.vercel.app/heart-failure.html | 心不全手帳（開発中・未配布） |

## 動かす

```bash
npm install
npm run dev      # 開発サーバー（http://localhost:5173）
npm run build    # dist/ に出力
npm run preview  # ビルド結果を確認
```

Node.js 18 以上が必要です。

## Vercel に公開する

1. このフォルダを GitHub のリポジトリに push する
2. Vercel で New Project → そのリポジトリを選ぶ
3. 設定はそのままで Deploy（`vercel.json` の内容が使われます）

以後は push するたびに自動で反映されます。URL は変わりません。

**ドメインは最初に決めて、あとから変えないでください。**
記録はブラウザがドメインごとに保存するため、URLを変えると患者さんの記録が見えなくなります。

## 更新するときの順番

QRコードの形式を変えたときは、**受付端末を先に更新**してください。
逆にすると、新しい患者アプリのQRを受付端末が読めません。

## データの保存について

- 記録・目標・教材の進み具合・受診日・体重は、ブラウザの localStorage に保存されます
- 暗証番号を設定すると、記録は AES-GCM で暗号化して保存されます（鍵は暗証番号から PBKDF2 で作ります）
- 暗証番号を忘れると記録は復元できません
- Face ID・指紋を登録すると、暗証番号なしで開けるよう鍵を端末内に控えます。そのぶん暗号化の効き目は弱まります

## 受付端末について

`/terminal.html` を院内の端末で開いてブックマークしてください。

- カメラでQRを読み取り、そろうと自動で印刷します
- 画面すみの歯車から設定（暗証番号で保護）。印刷の入切、CSV出力、保存先フォルダ、端末名を設定できます
- CSVの保存先フォルダを選べるのは Chrome / Edge のみです（iPadのSafariは非対応）
- ダイアログなしで印刷するには、Chrome を `--kiosk-printing` で起動してください

## 導入施設の追加

`src/Terminal.jsx` と `src/App.jsx` の `FACILITIES` に追記してください。
滋賀県外の施設は `pref` を付けると、地図に出さず一覧のみに掲載します。

## 開発を引き継ぐ方へ

`docs/development-notes.md` に、設計の理由と注意点をまとめています。
Claude Code などで作業する場合は、`CLAUDE.md` も置いてあります。

## 配布物（docs/）

ブラウザで開いて「印刷 / PDFで保存」を押してください。A4に合わせてあります。

- `docs/development-notes.md` … 開発メモ（設計の理由、既知の落とし穴、未着手の項目）
- `docs/setup-guide.html`（導入の手引き） … 導入の段階、費用、公開手順、受付端末の設置、運用開始までの手順
- `docs/manual-patient.html`（患者向け） … 1枚目が使い方、2枚目が設定のしかたと困ったときの対処
- `docs/manual-staff.html`（医療者向け） … 1枚目が医療者モードと受付端末の設定、2枚目がデータの扱いと更新手順
- `docs/poster-qr.html`（掲示・リーフレット） … 1枚目が受付カウンターに置く掲示、2枚目が患者さんに渡すリーフレット

掲示用は、上の欄にアプリのURLを入れて「QRコードを作り直す」を押すと、そのURLのQRになります。

## アイコン

`public/` にあります。琵琶湖の形をかたどったものです。

- `icon-192.png` / `icon-512.png` … ホーム画面用
- `icon-maskable-512.png` … Android の丸型・角丸に切り抜かれる形式用（余白を広めに取ってあります）
- `apple-touch-icon.png` … iPhone / iPad 用（180px）
- `favicon.svg` … ブラウザのタブ用

作り直す場合は、`src/App.jsx` の `GEO_BIWAKO`（琵琶湖の輪郭）から生成しています。

## 出典

- 教材：日本高血圧学会「高血圧管理・治療ガイドライン2025」、国立成育医療研究センター 妊娠と薬情報センター
- 地図：国土数値情報「行政区域」（市町の境界）、Natural Earth（琵琶湖）
