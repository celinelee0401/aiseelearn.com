# Fluency Challenge 收工交接

最後更新：2026-10-11（Asia/Taipei）；最後更新者：Codex

## 目前做到哪

- 2026-09-27 從遠端 `main` 建立獨立分支 `codex/fluency-challenge-20260927`，只納入 Fluency Challenge、四軌教師面板、必要的共用學生身分／資料庫依賴與相關測試。
- Fluency 應用程式碼基準 commit：`06a364d576e866df0de0d9444d832418b677902e`。2026-10-11 收工前核對遠端 `main` 仍為 `3db026cc8f8501c66957e8625e14d02e0b1e3256`。
- Git push 只保存程式碼與文件，不能視為 Vercel、Netlify、Apps Script 或資料庫的部署／遷移。

## 可運行與驗證狀態

- 2026-09-27 在隔離分支執行 Fluency、座位規劃與共用身分相關測試：90/90 通過；Vercel 暫存打包成功；`git diff --check` 與密鑰格式掃描無異常。
- 2026-10-11 僅重新核對 GitHub 分支與本地 Git 狀態，**未重跑測試或正式環境端對端驗收**。
- 尚未做整個 99 檔變更的正式 code review；目前不能據此宣稱所有班級裝置或正式部署已驗收。

## Git 與資料安全邊界

- 本地原專案仍在 `main`，有兩筆早先的教材 commit 尚未推送，且工作樹含大量其他未提交變更。不要對這個工作樹執行 `git add -A`、直接推 `main`，或重置／覆蓋使用者資料。
- Fluency 分支已在 GitHub；要續作時，應重新從遠端分支建立乾淨 checkout，不要直接切換本地混雜的 `main` 工作樹。
- 本地 `.env.local`、PIN、HMAC 與 Azure 金鑰不應進 Git、Obsidian 或交接文件。
- 本地 `handoff.md` 與 `踩坑紀錄.md` 是此次收工新建檔案；Celine 已於 2026-10-11 確認只將這兩份檔案提交並推送到 Fluency 專用分支。這不授權處理其他檔案、`main` 或部署。

## 下一步（依序）

1. 對 Fluency 專用分支做正式 code review，特別檢查共用身分、教師權限、錄音與資料庫邊界；有修正再跑相關測試。
2. 以真實上課裝置核對學生三輪錄音與教師端各輪分數，記錄正式環境端對端結果。未驗證前不要把 Git 分支推送當成部署完成。
3. 另行決定 Fluency 分支是否要併回 `main`、如何處理原本兩筆教材 commit 與混雜的本地工作樹；任何合併、提交、推送或部署均須再確認。

詳細流程與踩坑見本專案 `踩坑紀錄.md`，以及 Obsidian `AI Agent 工作流程/Fluency Challenge｜實作流程與踩坑紀錄.md`。
