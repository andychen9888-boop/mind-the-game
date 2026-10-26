# 資料格式

兩種檔案：播放器讀的**案例檔**（`data/cases/*.json`，schema `mtg-case-1`），以及合成資料流程讀的**合成輸入檔**（`data/synthetic/*.input.json`，`mtg-synthetic-input-1`）。

驗證器是唯一的權威定義：案例檔看 `scripts/lib/case-schema.cjs`，合成輸入看 `scripts/pipeline/ingest.cjs`。本文件若與程式不一致，以程式為準並修正本文件。

## 發布流程

```
data/cases/<caseId>.json  ──node scripts/build-cases.cjs──▶  app/cases.js（window.MTG_CASES）
```

- 檔名必須等於 `caseId`。
- 任一案例驗證失敗，整個建置失敗，`app/cases.js` 不會更新。
- `app/cases.js` 是產生物，不要手改。`npm run check` 會檢查它與 JSON 是否同步。
- 用 JS bundle 而不是 fetch JSON，是為了讓雙擊 `app/index.html` 仍可使用。

## 案例檔 mtg-case-1

所有面向使用者的文字都是 `{ "zh": "...", "en": "..." }`，兩種語言都必填。

| 欄位 | 說明 |
| --- | --- |
| `schemaVersion` | 固定 `mtg-case-1` |
| `caseId` | 小寫 slug，等於檔名 |
| `dataKind` | `manual-reconstruction`、`synthetic` 或 `licensed-tracking` |
| `generation.explanations` | `manual`、`offline-template`、`ai-generated`、`ai-generated-reviewed`。AI 類必須同時填 `generation.model` |
| `generation.segmentation` | `manual` 或 `event-rules` |
| `generation.positions` | `illustrative`、`synthetic`、`video-estimated` 或 `measured`。合成案例必須是 `synthetic`；人工重建不可宣稱 `measured` |
| `snapshotProvenance` | 選填。每個 snapshot、每位球員的位置來源：`observed`、`manual`、`interpolated`、`not-observed` 等；`not-observed` 必須且只能對應 `null` 位置。播放器聚焦時會顯示 |
| `positionMethod` | 選填。位置估計方法摘要與校準統計 |
| `generation.aiAttempt` | 選填。AI 嘗試結果：`accepted`、`rejected`、`error` 或 `not-configured`，含步驟與被拒原因 |
| `menuLabel` | 案例選單上的名稱 |
| `match` | `home`、`away`、`attackingTeam`（team id）、`scoreBefore`、`scoreAfter`、`goalTime`（比賽秒數；時鐘到達時比分切換）、`headline`、`subline`、`scorer`、`assist` |
| `teams.<id>` | `name`、`short`（記分板縮寫）、`kit`（body、ring、shirt、badge 為 hex，stripe 可為 null） |
| `attackingDirection` | 目前只支援 `ltr` |
| `coordinates` | `range [0,100]`、`units`、`measured`（非授權追蹤資料必須是 false） |
| `sources` | 至少一項：`label`、`url`（可為 null）、`checked`（核對狀態） |
| `rights`、`limitations` | 權利與限制說明 |
| `ui.chips` | 聚焦按鈕顯示的球員 |
| `ui.labelWhenRelevant` | 該階段相關時在球場上顯示名稱的球員 |
| `ui.footer` | 頁尾說明 |
| `about.zh`、`about.en` | 「關於回放」的段落陣列 |
| `players[]` | `id`、`name`、`tag`（選填，球場上的短標籤）、`short`（頭像徽章，最多 3 字）、`team`、`seed`（頭像樣式）、`identityStatus` |
| `snapshots.<name>` | 每位球員一個 `[x, y]` 或 `null` |
| `events[]` | `id`、`t`（比賽秒數，依時間排序）、`type`、`actor`、`recipient`、`start`、`end`、`detail` |
| `phases[]` | 見下表 |
| `summary` | `title`、`intro`、`cards[]`（`tag`、`title`、`text`、`playerIds`、`phaseIds`） |

`identityStatus` 的值：`verified`、`named-in-sources`、`role-label`、`unknown`、`fictional`。合成案例必須全部是 `fictional`。

### 位置與缺失

- 座標是 0–100 的繪圖空間，x = 0 是進攻方本方球門線。它不是公尺。
- `null` 表示這個時間點沒有觀察到，例如在鏡頭外。播放器會隱藏該球員，並在聚焦時顯示「此階段未觀察到位置」。
- 不可用 `[0,0]` 代表缺失。驗證器會發出警告。
- 每個 snapshot 都必須列出所有球員，缺的球員寫 `null`，不能省略欄位。

### phases[]

| 欄位 | 說明 |
| --- | --- |
| `id` | 唯一，例如 `p1` |
| `start`、`end` | 比賽秒數。階段必須首尾相連 |
| `from`、`to` | snapshot 名稱。`to` 必須等於下一階段的 `from` |
| `keyframes` | 選填，`[[t, snapshot], ...]`，t 在 0 和 1 之間且遞增，用於階段中間的位置 |
| `focus` | 該階段重點球員 |
| `ball` | `[[t, x, y], ...]`，t 從 0 到 1 嚴格遞增 |
| `arcSegments` | 選填，要畫成空中弧線的球路段索引。弧線只是視覺效果 |
| `zone` | 選填，`[cx, cy, w, h]` 示意區域 |
| `title`、`short`、`sub`、`insight`、`evidence` | 雙語文字 |
| `simple[]`、`deep[]` | 解說列：`kind`、`label`、`text`、`refs`（事件 id）。`deep` 至少要有一列 `observation` |
| `eventIds` | 該階段相關事件 |
| `evidenceRefs[]` | 至少一項：`video-clock`（`from`、`to`、`note`）、`event`（`id`）或 `synthetic-input`（`file`） |
| `verification` | 選填，`status` 與 `note`。status 可為 `confirmed`、`partly-confirmed`、`not-verifiable`、`contradicted`、`synthetic-by-construction` |

解說列的 `kind`：

| kind | 意義 |
| --- | --- |
| `observation` | 資料或畫面中看得到的事 |
| `interpretation` | 合理但未證實的戰術推論，要附限制 |
| `outcome` | 動作之後觀察到的變化 |
| `limit`、`unknown` | 資料無法回答的部分 |
| `watch` | 給觀眾的觀看提示 |
| `recap` | 整段回顧 |

### 捏造精度檢查

除了 `licensed-tracking`，任何文字只要出現百分比、帶數字的 xG、速度或距離單位（公尺、km/h 等），驗證就會失敗。要寫這類內容，必須先有真的量測資料。

## 合成輸入檔 mtg-synthetic-input-1

由 `scripts/synthetic/generate-counter-01.cjs` 產生。

| 欄位 | 說明 |
| --- | --- |
| `inputVersion` | 固定 `mtg-synthetic-input-1` |
| `caseId`、`dataKind` | `dataKind` 必須是 `synthetic` |
| `generator` | 產生方式、可見性模型、擬真說明 |
| `match` | `competition`、`home`、`away`、`attackingTeam`、`scoreBefore`、`scoreAfter` |
| `teams`、`players` | 同案例檔，球員另有 `role`（GK、CB、DM 等） |
| `events[]` | `id`、`type`、`t`、`dur`（球移動或帶球的時間）、`actor`、`recipient`、`start`、`end`、`detail` |
| `frames[]` | `t`、`ball`、`positions`（每位球員 `[x,y]` 或 `null`） |

可見性模型：模擬轉播鏡頭，只拍到球附近的範圍。距離球超過 34 單位的球員，該影格位置設為 `null`。這讓流程必須處理缺失資料，和真實影片標註的情況一樣。

## 分段規則（scripts/pipeline/interpret.cjs）

依時間順序切出階段，短於 1.5 秒的階段會併入前一段：

| 規則 | 切點 |
| --- | --- |
| press-start | 搶回球前 6 秒內有逼搶時，從第一次逼搶前 0.5 秒開始 |
| possession-start | 否則從奪回球權或第一次觸球前 0.5 秒開始 |
| middle-third-entry | 進攻方的球首次進入中場三分之一 |
| switch-of-play | 傳球的橫向移動達 40 單位以上（球場寬度 0–100） |
| final-third-entry | 進攻方的球首次進入前場三分之一 |
| final-ball | 射門前最後一次傳送 |

只計算進攻方、且在球權開始之後的事件。事件的 `detail` 可為 `cutback`、`switch`、`goal kick, short`、`header`、`tackle`、`interception`，會影響解說用語；`press` 事件的 `recipient` 是被逼搶的對手。

## 新增一個合成案例

1. 參考 `scripts/synthetic/generate-buildup-02.cjs`，用 `scripts/synthetic/lib.cjs` 寫新的產生器：參與進攻的球員給路徑點，其他球員用陣型跟隨規則。檔名必須是 `generate-<名稱>.cjs`，輸出 `data/synthetic/<名稱>.input.json`。
2. 執行 `node scripts/pipeline/run.cjs data/synthetic/<name>.input.json`。
3. 如果要讓伺服器能用 AI 重新產生，在 `server/server.cjs` 的 `INPUTS` 加上對應。
4. 執行 `npm run build`，再執行 `npm run check`。
