# Fluency Challenge｜下週課堂使用前檢查（2026-09-19）

## 2026-10-11 正式鏈路查核與資料庫喚醒（以本節為最新狀態）

- 正式座位表（115-1）已能載入單元設定；唯讀查核正式 Supabase：2 個單元、3 個開放中活動（816 B3U2 09-22、801 B3U2 09-24、801 B3U1 09-24）、84 筆 assignment、3 筆 attempt。801 B3U2 於 09-24 有一位學生完成 R1–R3，`assessment_provider = azure-speech-pronunciation`，WPM／停頓流暢／發音清晰／語調節奏皆有分數。**正式「教師開活動 → 學生登入錄音 → Azure 評分 → 存檔」已實際跑通。**
- 三個活動自 9 月起仍為開放；是否結束由教師決定。
- 正式 Supabase 仍為 Free；已在 115-1 座位表加入每日唯讀喚醒（版本 8），需擁有者在 Apps Script 編輯器執行一次 `installFluencyKeepAliveTrigger` 完成授權與排程。
- 學生端「結果聚焦進步」經 staging DEMO 實測後，2026-10-11 由擁有者部署至正式站（deploy `6acb6a0851b21ba739a0b815`；回退基準 `6ab09745b7561c1e1af6c156`）。後端 10 個 Functions 由 Fluency 分支打包，相較 9/21 版只多了 9/22 修改的學生身分轉接程式。冒煙檢查：首頁／程式 200、未登入 401、錯誤 PIN 正確拒絕、DEMO 測試圖片 404。

## 2026-09-21 正式站更新

- 擁有者已輪替 Azure Speech Key2，並自行在正式 Netlify 站將 `AZURE_SPEECH_KEY` 設為 secret；唯讀查核確認 production context 有值，未讀取金鑰明文。正式站另已設定 `AZURE_SPEECH_RECOGNITION_URL` 為 East Asia 辨識端點，並再次唯讀確認。`FLUENCY_ASSESSMENT_MODE=azure`、連續評測開啟、增強轉錄關閉；增強轉錄所需的資源端點目前非必要。
- 73 項 Fluency 本機測試與 Netlify TypeScript 型別檢查通過。以明確白名單重新打包學生頁與 10 個 Fluency Functions，於 2026-09-21 發布至正式 `https://fluency-challenge.netlify.app/`；部署 ID `6ab09745b7561c1e1af6c156`，Netlify 顯示 ready、production、current。原舊版部署 ID `69e031990264cbb5b3a17e59` 保留作應用回退基準，不修改正式資料庫或清除學生成績。
- 正式網址唯讀 smoke：首頁、`app.mjs`、`styles.css` 均回 200；測試 PIN 參考圖片回 404；未登入的 `/api/fluency/session` 與 `/api/fluency/task?unitId=B3U1` 都回預期 401。這些只證明基本發布與身分邊界，不等於 Azure 金鑰可用、真實學生登入／三輪錄音成功、教師進度同步或多人容量驗收。
- **尚未核准全班直接使用。**下一步先由教師選少量授權學生在正式網址測試：登入／首次設 PIN、指定軌別與秒數、三輪錄音／Azure 分數、重新整理恢復、教師座位卡進度、登出與重試。若出現異常，暫停開新活動並回退應用部署；不要以舊備份覆蓋共用 Supabase 資料。

## 目前環境邊界

- `fluency-challenge-staging.netlify.app` 是新版學生端；教師端是隔離的 `Fluency Challenge Seat Planner Staging`。後者目前只配置 `9999 / DEMO` 與四位虛構學生，不等於真實班級入口。
- `fluency-challenge.netlify.app` 仍是舊版。現階段不得把新版測試成功解讀為正式站或真實班級已完成上線。
- 學生端已在 staging 加上成功載入任務後的 `?unit=` 網址同步、任務頁實際單元代碼，以及三輪完成的進度提示。這些 UI 修正不變更既有錄音或成績。
- 本機的基礎 migration `202609030003_fluency_challenge_core.sql` 曾為 0 bytes，已依後續 migration、服務契約與測試重建；2026-09-20 六份 Fluency 專用更新已套用到正式資料庫（詳見下方），但正式網站尚未發布。
- Netlify 帳戶目前仍有 `fluency-challenge.netlify.app`（舊版）與 `fluency-challenge-staging.netlify.app`（新版）。正式網址尚未被新版覆寫。
- 舊座位表 Web App URL 在目前學校帳號下回傳找不到網頁；可登入的 `Fluency Challenge Seat Planner Staging` 只含 `9999 / DEMO` 四名虛構學生，不能用於 801／816。
- 115-1 新複製的 Apps Script 專案已在 2026-09-19 推送教師座位表與 Fluency 面板。擁有者已完成 Google 授權與教師／小老師密碼設定；版本 2 部署回傳 HTTP 200。已以教師身分唯讀載入 801（27 名）與 816（30 名）座位及 S1–S4。讀取 B2U3 單元時顯示「讀取單元設定服務尚未完成設定」；尚未通過 Fluency 後端與端到端測試。原 114-2 專案未修改。
- Netlify 新版 staging 站有測試後端環境變數；舊正式站的環境變數清單目前為空。不能直接把 115-1 真實班級接到 `9999 / DEMO` 測試後端，也不能僅覆寫正式靜態頁就宣稱可用。
- 801／816 的真實名單、座位、S 軌與計分板來源是 `115 G8` 試算表的 `801_名單`、`816_名單`；新複製的 `115-1 課堂紀錄` 試算表不是座位表程式目前讀寫的來源，不要清空或刪除。

## Netlify 站台唯讀核對（2026-09-20）

- 已用 Netlify 連接器核對兩個獨立站台。`fluency-challenge-staging` 原部署為 `6aae4a0a7fdfaa06d554d523`（2026-09-19 發布，ready），由 CLI 發布，含 10 個 Fluency Functions；2026-09-20 先更新至 `6aaf761198b6c0238148d554`，再以相同 10-Function 白名單但只含執行所需靜態檔的包更新至 `6aaf7db870c94010b7b067dd`（詳見下方驗證）。`fluency-challenge` 的已核對部署仍是 `69e031990264cbb5b3a17e59`（2026-04-16 發布，ready），為手動部署的單頁舊版，沒有 Functions。兩個站台的部署狀態是各自獨立的，不能把 staging 成功當作正式站已升級。
- staging 目前有 16 個環境變數名稱；正式站的環境變數清單為空。本次只核對名稱、作用範圍與部署資訊，未輸出金鑰值。新版程式的必要後端設定涵蓋 Supabase URL／伺服器金鑰／session secret、學生身分與課堂活動 HMAC、學生身分／任務／作答服務 URL，以及 Azure Speech 設定；可選辨識模式另有開關。正式站缺少的不只是靜態頁，還有 Functions 與獨立正式環境設定。
- staging 部署欄位中的 `context=production` 指「staging 這個站台自己的 production deploy」，**不代表它已連到正式資料庫**；本次未檢視環境變數值，也未確認其資料庫目標。不能複製 staging 金鑰值或直接將 115-1 教師端導向 staging 作為正式班級服務。兩站均未設定 Netlify 訪客密碼或團隊 SSO；學生身分與教師權限必須由應用程式後端控管。
- 115-1 Apps Script 的 `FLUENCY_RUN_SERVICE_URL`、`FLUENCY_TEACHER_SERVICE_URL` 和 `FLUENCY_RUN_API_HMAC_SECRET_CURRENT` 是教師端另外需要的介接設定；這些不是只在 Netlify 設定即可生效。本輪未新增或變更任何 Netlify／Apps Script 設定，也未部署。

## 全班語音容量與失敗復原（2026-09-20）

- 擁有者於 2026-09-20 授權將 Azure Speech 測試資源 `ai-see-learn-speech-staging-celine` 由 Free F0 升到 Standard S0；已在 Azure Portal 套用，並從資源「概觀」二次確認定價層為「標準」。此為用量計費資源；升級的是 staging 資源，**不是正式環境的獨立語音資源，也不是全班容量實測**。Netlify staging 現行設定的 `FLUENCY_CONTINUOUS_ASSESSMENT_ENABLED=true`，使用 Speech SDK 的連續即時辨識；`FLUENCY_ENHANCED_TRANSCRIPT_ENABLED=false`，快速轉錄目前未啟用。依 [Microsoft Speech 官方配額](https://learn.microsoft.com/en-ie/azure/ai-services/speech-service/speech-services-quotas-and-limits)，S0 即時辨識預設 100 個並行請求；服務層級變更仍須以實際負載測試及課堂設備驗證。
- 學生端已新增「同頁重新送出評測」：對網路中斷、408／429／5xx 或成功回應缺少評測內容時，暫存這一輪錄音於頁面記憶體並沿用同一 `attemptId`，讓學生手動重試，另可選擇放棄後重新錄音。409 已完成則重新讀取任務進度；錄音資料不合格等非暫時錯誤仍要求重錄。重新整理／關閉頁面會清除暫存錄音，並未寫入本機儲存或伺服器。2026-09-20 先部署至隔離的 `fluency-challenge-staging`，部署 ID `6aaf761198b6c0238148d554`；同日後續以僅含執行所需靜態檔的包更新至 `6aaf7db870c94010b7b067dd`，**未變更舊正式站**。目前 73 項 Fluency 本機測試通過，打包成功；staging 頁面與程式回 200，未登入的 session API 回預期 401。尚未在真實瀏覽器完成同頁重送、三輪或多人負載驗收，且**不能取代 Azure 容量規劃**。
- 曾先發布 staging 站的未公開預覽部署 `6aaf75dd8aa7ec04f0b3ca8c`；其靜態頁回 200，但 API 回 503，推測缺少該 deploy context 的環境設定。它**不是**可供學生測試的網址；請使用 staging 正式網址及目前部署。未修改預覽環境變數。
- 本機 Fluency 73 項測試與 Netlify TypeScript 檢查通過，部署包可建立。全 repo 測試另有 `platform-api-runtime.test.mjs` 的非 Fluency 失敗（`ASSIGNMENT_NOT_OPEN`／`SOLUTION_NOT_AVAILABLE`）；本輪未修改該模組，不把全 repo 測試說成全綠。正式部署前仍需在隔離環境做瀏覽器互動與多人同時送出驗收。

## 正式 Supabase 唯讀盤點（2026-09-19）

- 已核對 Celine 帳號下的 `ai-see-learn-self-correction`（project ref `nwgmaejtmsktdxatlsei`，`main / PRODUCTION`）；這是已被其他學生工具使用的共用正式專案，不是空白 Fluency 專案。
- `public` Table Editor 已見 `students`、`enrollments`、`service_gateway_nonces`，以及自主訂正、翻譯測驗與其他模組的資料表；按字母排序的清單中未見任何 `fluency_*` 資料表。僅檢視表名，未讀取或修改學生資料列。
- Database Migrations 顯示「Run your first migration」，表示 Supabase CLI 追蹤清單目前沒有已登錄 migration；**不能據此推論資料庫是空的**，現有資料表可能由 SQL Editor 或其他流程建立。不可直接對正式專案執行整包 `db push` 或重跑會重複 `create table` 的基礎 migration。
- 本機 `202609030003_fluency_challenge_core.sql` 需要既有 `students`／`enrollments`，建立六張 `fluency_*` 表與函式；後續 Fluency migration 仍須依序審查與套用。2026-09-19 先前在正式 SQL Editor 執行唯讀盤點時，查詢結果被記錄為 `students` 只有 `id uuid`、`created_at timestamptz`；同日晚間的正式庫 CLI dump 則包含 `students.archived_at`。2026-09-20 已在核對過 project ref `nwgmaejtmsktdxatlsei` 的正式 Dashboard 重新唯讀查詢 `information_schema.columns`，結果確認 `students` 目前有 `id uuid`、`created_at timestamptz`、`archived_at timestamptz` 三欄；先前「只有兩欄」的觀察已被最新現場查詢排除。Fluency 核心 migration 不依賴 `archived_at`。
- 唯讀盤點確認：兩張共用身分表都開啟 RLS，沒有針對它們的 RLS policy；`anon`／`authenticated` 沒有直接 SELECT 權限，`service_role` 有。`students.id`、`enrollments.id` 為主鍵，`enrollments.student_id` 外鍵指向 `students.id`；`(school_year, class_code, seat_number)` 有唯一約束及對應索引，`student_id` 另有索引。`public` 未見 `fluency_*` 表或名稱含 `_fluency_` 的函式；`gen_random_uuid()` 可用。這只證明結構前置條件，**不等於正式 migration 已可安全套用**。
- 已新增 `scripts/build-fluency-production-sql.mjs`，只按固定順序輸出六份 Fluency migration，排除現有自主訂正／共用身分建表，並以 SHA-256 鎖定本輪修正後的候選版本。`--check` 只列檔名與雜湊；預設輸出是待審 SQL 候選稿，**不會自行連線或套用**。修正前在隔離 PostgreSQL 演練時，錄音寫入函式的複合列變數用法讓整包 migration 中止；修正後整包可套用到正式結構的本機副本。另一個教師進度查詢的 `round_number` 歧義也由假資料端到端測試抓出並修正。
- 已準備 `operations/fluency-production-readonly-preflight.sql`：八段唯讀結構查詢，涵蓋必要欄位、索引／限制、RLS／政策／表權限、Fluency 函式名稱衝突及 `gen_random_uuid()`。上述檢查已在正式庫逐項執行（首個輸入曾有語法錯誤，修正後成功；錯誤查詢未修改資料）；未讀取學生資料列，未執行 DDL／DML。
- 這個正式 Supabase 專案的 Dashboard 顯示 `Celine's Org FREE`。依 [Supabase 官方備份文件](https://supabase.com/docs/guides/platform/backups) 與[CLI 匯出說明](https://supabase.com/docs/reference/cli/supabase-db-dump)，Free 不提供可依賴的自動備份。已使用 Supabase CLI 匯出正式資料庫備份；備份不可放在公開 repo。2026-09-20 已嘗試本機完整還原，但因 `auth` 系統表版本／欄位不相容而中止；**仍不得僅憑匯出成功就套用正式 migration**。
- 擁有者表示不知道正式資料庫密碼；**尚未重設**。這份本機專案的應用程式設定使用 `SUPABASE_URL`／`SUPABASE_SECRET_KEY`，未找到直接 PostgreSQL 連線字串；但正式資料庫還供其他工具使用，不能由此推定重設密碼對全部服務無影響。依 [Supabase 官方重設說明](https://supabase.com/docs/guides/troubleshooting/how-do-i-reset-my-supabase-database-password-oTs5sB)，若最終需要重設，應由擁有者在 Dashboard 的 Database > Settings 操作，事前先盤點所有直接資料庫連線，事後更新其密碼並驗證。不可把新密碼貼進聊天、Git 或筆記。
- 擁有者已同意使用官方 CLI 的無資料庫密碼匯出路徑。2026-09-19 在本機安裝 Docker CLI、Colima，並於隔離暫存目錄安裝 Supabase CLI 2.117.0；獨立 `fluency-backup` Colima VM 用於 dump。以 Celine 帳號登入後核對正式 project ref `nwgmaejtmsktdxatlsei`，已匯出 `roles.sql`（370 bytes）、`schema.sql`（82,517 bytes）、`data.sql`（990,033 bytes）到私人備份目錄 `/Users/celinelee/.codex/private-backups/fluency/20260919-k7IIqa`（目錄 `0700`、三檔 `0600`，FileVault 已啟用，不在同步 repo）。結構檔有 37 張 `public` 表；資料檔有 70 個完整的 COPY 區段，包括 `public`、`auth` 和 `storage` 的資料。已核對三檔非空、SHA-256 與 COPY 起訖數量一致；**未做完整資料還原演練**。這是資料庫匯出，不含 Supabase Storage 物件實體檔案，也不等於整個專案設定的完整備份。CLI 已建立會過期的資料庫登入角色；本機 CLI 已登出，Supabase Dashboard 的個人存取 token `Fluency-Backup-20260919` 已依擁有者確認刪除，頁面顯示成功且清單為空。
- 已在無對外網路的本機 PostgreSQL 容器匯入正式 `schema.sql`（不匯入學生資料），套用修正後的六份 Fluency 候選 migration，並以 `tests/sql/fluency-production-smoke.sql` 的四位虛構學生完成新單元、四軌規則、活動快照、題目／秒數凍結、錄音、恢復、教師進度與關閉活動的交易式測試；所有假資料在測試結尾 rollback。另有 69 項本機 Fluency 測試通過。這是**結構副本演練，不是正式資料庫寫入，也不是完整資料還原**。
- 2026-09-20 在另一個無對外網路的本機容器嘗試完整還原 `data.sql`，首個 `auth.audit_log_entries` COPY 因本機映像缺少 `ip_address` 欄位失敗；此為本機系統 schema 與匯出格式不相容，未對正式庫操作，亦不能用此結果推論備份本身毀損。接著只匯入 37 張 `public` 表的資料區段，成功核對 123 筆 `students`、123 筆 `enrollments`，其中 115／801、115／816 各 30 筆 active enrollment。六份 Fluency 候選 migration 套在這份含真實 `public` 資料的離線副本上成功；四軌假資料 smoke test 再次通過並 rollback，測後 `fluency_runs`／`fluency_assignments`／`fluency_attempts` 皆為 0。含真實資料的臨時容器已移除、Colima 已停止；私人原始備份仍保留。這提升 `public` 部分的可還原信心，**不等於 auth、storage 或整個 Supabase 專案可完整還原**。
- 正式資料備份中的 `115／801` 有 30 筆 active enrollment、`115／816` 有 30 筆；教師座位表先前唯讀載入為 801：27 名、816：30 名。801 的 3 筆差異已定位到座號 1、17、30（見下文），教師已確認它們是本學期空號，**不可直接刪除或自行指派 S 軌**。備份中 801 有 12/30、816 有 26/30 筆已具 PIN hash；其餘須確認啟用碼／首次設 PIN 流程是否可供課堂使用。
- 2026-09-20 透過 Google Sheets 唯讀核對來源 `115 G8 Celine's English Dashboard`：`801_名單` 的資料列只有 27 名在班、有姓名與 S 軌的學生，座號 **1、17、30 完全沒有資料列**；`816_名單` 有座號 1–30 共 30 名。並非三筆「姓名空白但仍列在座位表」的列。2026-09-20 已在正式 Supabase Dashboard 對 `public.enrollments` 重新執行唯讀查詢：115／801、115／816 各有 30 筆 active enrollment；801 有 12 筆 PIN、18 筆啟用碼，816 有 26 筆 PIN、4 筆啟用碼。801 座號 1、17、30 **目前仍為 active**；1、17 號沒有 PIN、有啟用碼且未啟用；30 號有 PIN、無啟用碼且已啟用。不得猜測這三筆的實際學生身分。
- 教師開課程式只把目前座位表 `seed.students` 傳為 assignment；Fluency 建立快照時只會對傳入的座號查詢 active enrollment，故 27 人活動理應只產生 27 筆任務，但資料庫多出的 active 身分仍可影響該座號的登入與其他共用工具。尤其 30 號已有 PIN，不可僅以活動排除三人就認定身分資料已一致。`(school_year, class_code, seat_number)` 是不論 active 狀態的唯一約束，不能以「停用舊列再插入同座號新列」當作未經審核的修補。`operations/fluency-roster-reconciliation-readonly.sql` 的三段核對查詢已於 2026-09-20 在核對過 project ref 的正式 SQL Editor 執行；沒有寫入資料。
- 2026-09-20 教師已確認 801 座號 **1、17、30 是本學期空號**，可保留作教師測試，但不應把這句話解讀為已授權重設 PIN、修改正式身分或讓測試錄音混入真實班級成績。三號目前不在 `801_名單`，現有一般開課流程不會把它們加入 Fluency 快照；因此「保留」不等於「已能用這三號完成三輪測試」。已在本機結構副本測試中加入額外 active enrollment、但未列於教師指派的情境；確認它不會得到學生任務，也不計入教師進度。正式測試入口仍須另行設計，並先核對現行資料庫狀態；30 號已有 PIN，尤不可猜測或覆寫其憑證。
- 先前修正的 production SQL 候選稿現已按下方紀錄套用到正式庫；既有 staging 資料庫仍是先前部署版本。後續若用 staging 驗收這些 SQL 修正，必須先以獨立的增量更新同步其函式，不能以「本機 migration 改過」推定 staging 已自動更新。
- 目前 `scripts/build-fluency-staging-sql.mjs` 僅列入前五份 migration（包含已存在的自我訂正核心），未包含 2026-09-05／09-08 的後續 Fluency 更新；**不能拿它的輸出直接套用到這個正式共用專案**。應另產生經審核、只含尚缺 Fluency migration 的固定順序檔。

## 正式 Supabase Fluency 專用更新（2026-09-20）

- 擁有者在備份與回退方式核對後，明確同意只將六份 Fluency 專用 migration 套用至正式 `ai-see-learn-self-correction`（project ref `nwgmaejtmsktdxatlsei`）。執行前重新唯讀確認共用 `students`／`enrollments` 結構、唯一約束、外鍵、`gen_random_uuid()` 均符合前置條件，正式庫尚無 Fluency 表與同名函式。
- 透過 `scripts/build-fluency-production-sql.mjs` 產生只含六份 Fluency migration 的 `begin; … commit;` 交易稿，在 Supabase 正式 SQL Editor 內以複製回讀方式逐位元核對為 48,950 bytes、SHA-256 `0b2657357b54c23f15107b03ec8a333fed7f07e1a4ba6fdf52043f3ec53532e0`，再執行一次。SQL Editor 回報 `Success. No rows returned`；沒有執行整包 staging bundle、共用身分或自主訂正基礎 migration。此 SQL Editor 執行不會自動替 CLI migration 追蹤清單補登紀錄，日後不得盲目 `db push` 重跑。
- 獨立唯讀驗證結果：正式庫有 7 張 `fluency_*` 表、7 個名稱含 `fluency` 的函式，7 張 Fluency 表全部啟用 RLS；原有 `students`／`enrollments` 兩張共用身分表仍存在。四軌預設時間為 S1／S2 `35→30→25` 秒、S3／S4 `30→25→20` 秒。這是結構與預設資料驗證，不是全班登入／錄音／評分的端到端驗收。
- 六份更新只新增 Fluency 專用物件與四軌預設資料，未對既有學生、enrollment 或其他模組資料列執行更新／刪除。私人事前備份仍保留；完整 `auth`／`storage` 還原未演練成功，若後續應用異常，優先停止新活動與回退應用部署，不直接刪除 Fluency 紀錄或以舊備份覆寫共用正式庫。
- 此輪沒有變更 Netlify 正式站、其環境變數、115-1 Apps Script 的 Fluency 介接設定或真實學生 PIN。正式站仍是舊版；正式後端連線、少量授權學生試行及全班容量測試尚待完成。

## 正式站後端介接準備（2026-09-20）

- 重新以 Netlify 專案清單與環境變數中繼資料核對：正式 `fluency-challenge`（site ID `eabaceb2-80a7-40e3-940d-22ff2d13317b`）仍為 2026-04-16 的舊版部署，環境變數 **0 項**；隔離 `fluency-challenge-staging`（site ID `de8c0373-035d-4188-86bd-e146aac999d9`）有測試專用變數。未讀取或輸出變數實值，也未將 staging 的 Supabase／HMAC／session 密鑰複製到正式站。
- 正式 Netlify Functions 至少需要正式 Supabase URL 與 server-only key、`SESSION_SECRET`、`IDENTITY_GATEWAY_HMAC_SECRET_CURRENT`、`FLUENCY_RUN_HMAC_SECRET_CURRENT`、`STUDENT_IDENTITY_HMAC_SECRET_CURRENT`、`FLUENCY_SESSION_SECRET`、三個內部服務 URL（student identity、task、attempt），以及 Azure Speech 辨識 URL、key 與連續評測開關。若內部服務全在同一正式 Netlify 站，三個 URL 分別指向該站的 `/api/internal/student-identity`、`/api/internal/fluency-task`、`/api/internal/fluency-attempt`；同站身分 HMAC 成對一致，兩種 session secret 不共用。`staging-flow-check` 模式不得用於正式評測。
- 115-1 教師 Apps Script 另需 `FLUENCY_RUN_SERVICE_URL`、`FLUENCY_TEACHER_SERVICE_URL` 指向正式站 `/api/internal/fluency-runs`、`/api/internal/fluency-teacher`，其 `FLUENCY_RUN_API_HMAC_SECRET_CURRENT` 必須與正式 Functions 的 `FLUENCY_RUN_HMAC_SECRET_CURRENT` 成對一致。這是教師端另行配置，並非 Netlify 設好就自動連通。
- 發布包原先會連同 `apps/fluency-challenge` 中的 DEMO 帳號／PIN 參考圖片和 README 一起複製進靜態目錄。已把 `scripts/stage-fluency-netlify.mjs` 改為只打包 `index.html`、`app.mjs`、`styles.css` 和 `lib/`，仍只包含既有 10 個 Fluency Functions；新打包檢查 3/3 通過，實際暫存包頂層只有上述三個公開檔案。73 項 Fluency 測試與 Netlify TypeScript 檢查通過。先在 staging 預覽部署 `6aaf7d83987f7ae7df0b29f7` 驗證首頁 200、測試圖片 404，再更新隔離 staging 正式網址至部署 `6aaf7db870c94010b7b067dd`（ready、10 Functions）；正式 staging 首頁／`app.mjs` 回 200、該圖片回 404、未登入 session 回預期 401。舊的不可變部署網址可能仍保留舊圖；**沒有修改 `fluency-challenge.netlify.app` 正式站**。
- 正式站仍未設定任何密鑰，Azure S0 目前仍是命名為 staging 的語音資源；尚未決定正式環境要使用獨立 Speech 資源或暫時共用該 S0。設定任何正式 server-only 憑證之前需確認授權範圍；在配置與端到端驗收前，**不可直接把新版發到既有正式網址**。

## 可安全進行的下一輪測試

1. 教師用隔離座位表的 `DEMO` 班建立新測試單元、儲存題目與四軌時間，再開始本班活動。
2. 學生測試入口使用該單元專屬網址：`https://fluency-challenge-staging.netlify.app/?unit=<單元代碼>`。在登入欄再次核對代碼；載入後確認任務標題上方顯示同一代碼。
3. 以虛構帳號和測試音訊驗證 R1→R2→R3、結果保存、重新載入後恢復、完成並登出，以及教師端「更新進度」。避免把多位真實學生共用同一個 DEMO 帳號。
4. 用實際上課裝置及學校 Wi‑Fi 另做一次麥克風／錄音測試。不能只用教師電腦與家中網路的結果推定課堂可用。

## 真實班級啟用前的必過關卡

1. 確認下週要使用的班級、學生數、單元與日期，以及是否要替換既有正式網址。這是部署與學生資料範圍的決策。
2. 115-1 專案來源與 801／816 名單已核對（801：27 名；816：30 名），擁有者已完成 Google 授權和教師／小老師密碼設定，兩班畫面已唯讀驗證。下一步是建立並核對正式後端連線；不得將 staging 的 `9999 / DEMO` 帳號當作真實學生使用。
3. 六份 Fluency 專用 migration 已在正式 Supabase 套用並完成結構驗證；**不得**再對同一正式庫重跑該建表 bundle 或整包 staging／共用身分 migration。801 的 1、17、30 空號仍保留且未更動正式身分資料；若要讓空號進行教師測試，須另外設計隔離流程。
4. 在獨立正式環境核對資料庫 migration、HMAC／session 金鑰、Azure 配額與成本、Netlify 環境變數及教師端簽章介接；所有金鑰只放伺服器設定，不放前端或文件。
5. 先選少量授權的真實學生做端到端驗收：首次啟用或登入、教師指定軌別與時間快照、三輪錄音與保存、跨重新整理恢復、教師進度、登出、錯誤與重試。逐項確認後才能擴大到全班。
6. 課前準備復原方式：保留既有正式站和已知可用的 staging deploy；若新版本異常，停止新活動並回退部署，不清除學生錄音或紀錄。

## 目前判斷

正式 Fluency 資料庫結構已就位，但正式網站及教師端後端介接尚未就位；目前**尚不能宣稱已準備好讓 801／816 等真實班級全班直接使用**。下一步是配置獨立正式後端、驗證登入與三輪端到端流程，先以少量授權學生試行，再依容量與課堂設備測試決定全班開放。
