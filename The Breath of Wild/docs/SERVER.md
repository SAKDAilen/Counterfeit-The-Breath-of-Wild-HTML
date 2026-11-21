# Hyrule 云服务 / Backend API Reference

本地存档、排行榜与多语言接口，服务于 `main.html`。仅使用 Node.js 内置模块，无需 `npm install`。
Local save, leaderboard and i18n services for `main.html`. Uses only Node.js built-ins — no `npm install` needed.

- 版本 / Version: `1.0.0`
- 默认地址 / Default base: `http://127.0.0.1:8787`
- 数据目录 / Data directory: `data/`（可用 `DATA_DIR` 覆盖 / override with `DATA_DIR`）

## 启动 / Running

最简单的方式是双击 `start-server.bat`，它会使用项目自带的 Node 运行时。
The easiest way is to double-click `start-server.bat`; it uses the bundled Node.js runtime.

也可以手动启动 / Manual start:

```powershell
# PowerShell（无 node 在 PATH 时使用随附运行时 / bundled runtime）
& "C:\Users\12858\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" server\index.js
```

```bat
:: cmd.exe. HOST=0.0.0.0 允许局域网访问。
set HOST=0.0.0.0
set PORT=8787
start-server.bat
```

如果 Node.js 20+ 已在 `PATH` 中 / if Node.js 20+ is on `PATH`:

```bash
npm start
npm test
```

环境变量 / Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 / listening port |
| `HOST` | `127.0.0.1` | 绑定地址；设为 `0.0.0.0` 可被局域网访问 / bind address; set `0.0.0.0` for LAN access |
| `DATA_DIR` | `./data` | 持久化目录 / persistence directory |

打开游戏 / Open the game at `http://127.0.0.1:8787/`. 直接以 `file://` 打开 `main.html` 时，客户端默认连接 `http://127.0.0.1:8787`。

## 约定 / Conventions

- 所有 API 响应为 JSON（静态文件 404 除外）；错误统一为 / all API responses are JSON (except static 404s); errors use:
  ```json
  { "ok": false, "error": { "code": "ERROR_CODE", "message": "Human readable" } }
  ```
- 成功响应包含 `"ok": true`。
- 时间戳均为 ISO-8601 字符串，例如 `2026-11-07T01:23:45.000Z`。
- 每个响应都带 CORS：`Access-Control-Allow-Origin: *`，允许 `GET,POST,PUT,DELETE,OPTIONS`。
- Profile id 必须匹配 `^[A-Za-z0-9_-]{1,40}$`；slot 必须匹配 `^[a-z0-9_-]{1,16}$`。
- 请求体上限 2 MiB；单个存档 `data` 序列化后上限 1 MiB。
- 每位 IP 每分钟最多 60 个写请求（`POST`/`PUT`/`DELETE`），超出返回 `429 RATE_LIMITED`。GET 不限。
- 字符串长度按 Unicode 码点计算（排行榜昵称最多 24 个字符）。

## 接口 / API Endpoints

### `GET /api/health`

服务状态 / health probe.

```bash
curl http://127.0.0.1:8787/api/health
```

```json
{"ok":true,"version":"1.0.0","uptimeMs":1234,"features":{"cloudSave":true,"i18n":true,"leaderboard":true,"profiles":true}}
```

### `GET /api/config`

语言列表、功能和限制 / language list, features and limits.

```bash
curl http://127.0.0.1:8787/api/config
```

`languages` 中每项为 `{ "id", "nativeName", "entries" }`，`entries` 是词典条目数量。`limits` 为 `{"maxSaveBytes":1048576,"maxSlots":8}`。`maxSlots` 是给客户端的存档槽建议上限；服务端只强制 1 MiB 数据上限。

### `GET /api/i18n`

列出可用语言 / list available languages.

```bash
curl http://127.0.0.1:8787/api/i18n
```

### `GET /api/i18n/:lang`

读取某个扁平词典 / read one flat dictionary.

```bash
curl http://127.0.0.1:8787/api/i18n/en
```

```json
{"ok":true,"lang":"en","entries":2,"dict":{"你好":"Hello","世界":"World"}}
```

词典文件放在 `locales/<lang>.json`，格式为 `{"中文": "English"}`。文件在每次请求时读取；文件不存在返回 `404 LANG_NOT_FOUND`，不会导致服务崩溃。默认语言是 `zh-CN`。

### `GET /api/profile/:id`

获取（首次访问自动创建）玩家资料与存档槽 / get or auto-create a profile and list its slots.

```bash
curl http://127.0.0.1:8787/api/profile/link-abc123
```

```json
{
  "ok": true,
  "profile": {"id":"link-abc123","nickname":"Link","createdAt":"2026-11-07T01:00:00.000Z","updatedAt":"2026-11-07T01:00:00.000Z"},
  "slots": [{"slot":"auto","size":42,"updatedAt":"2026-11-07T01:01:00.000Z","summary":"初始台地"}]
}
```

### `GET /api/save/:id?slot=auto`

读取云存档 / load a cloud save. 不存在时返回 `404 SAVE_NOT_FOUND`。

```bash
curl "http://127.0.0.1:8787/api/save/link-abc123?slot=auto"
```

```json
{"ok":true,"slot":"auto","data":{"hearts":3},"updatedAt":"2026-11-07T01:01:00.000Z"}
```

### `PUT /api/save/:id/:slot`

写入云存档 / store a cloud save. 请求体：`{ "data": { ... }, "meta": { "playtime": 120, "summary": "初始台地" } }`。`data` 必须是 JSON 对象；`meta` 可选。

```bash
curl -X PUT "http://127.0.0.1:8787/api/save/link-abc123/auto" \
  -H "Content-Type: application/json" \
  -d '{"data":{"hearts":3,"location":"初始台地"},"meta":{"playtime":120,"summary":"初始台地"}}'
```

```json
{"ok":true,"slot":"auto","updatedAt":"2026-11-07T01:01:00.000Z","size":42}
```

错误码：`SAVE_INVALID`（非对象数据 / 非法 meta）、`SAVE_TOO_LARGE`（超过 1 MiB，HTTP 413）、`INVALID_SLOT`。

### `DELETE /api/save/:id/:slot`

删除存档；无论是否存在都返回 200 / delete a save; returns 200 either way.

```bash
curl -X DELETE "http://127.0.0.1:8787/api/save/link-abc123/auto"
```

```json
{"ok":true,"deleted":true}
```

### `GET /api/records?board=all`

读取排行榜；`board` 可为 `all`、`korok`、`shrines`、`ganon`。响应始终包含三个榜单，每榜按数值降序，最多 20 条 / read leaderboards; always returns all three boards, top 20 desc.

```bash
curl "http://127.0.0.1:8787/api/records?board=all"
```

```json
{"ok":true,"boards":{"korok":[{"name":"Link","value":30,"updatedAt":"2026-11-07T01:02:00.000Z","meta":null}],"shrines":[],"ganon":[]}}
```

### `POST /api/records`

提交成绩 / submit a record. `board` 必须是 `korok`、`shrines` 或 `ganon`；`name` 为 1–24 字符；`value` 为有限非负数。每个榜单只保留前 100 条。

```bash
curl -X POST http://127.0.0.1:8787/api/records \
  -H "Content-Type: application/json" \
  -d '{"board":"korok","name":"Link","value":30}'
```

```json
{"ok":true,"rank":1,"board":"korok"}
```

### `GET /api/stats`

统计信息 / server statistics.

```bash
curl http://127.0.0.1:8787/api/stats
```

```json
{"ok":true,"profiles":1,"saves":2,"records":{"korok":1,"shrines":0,"ganon":0},"uptimeMs":1234}
```

### `OPTIONS /api/*`

任何 `/api/*` 的 CORS 预检均返回 `204` 和 CORS 头 / preflight returns 204 with CORS headers.

## 静态文件 / Static files

项目根目录即网站根目录 / the project root is the web root:

- `GET /` 和 `GET /main.html` → `main.html`
- `assets/`、`js/`、`locales/`、`docs/` 等根目录内的文件可按相对路径访问。
- `server/`、`data/`、`package.json`、`start-server.bat` 等私有文件被静态服务器拒绝。
- 支持 `ETag`/`If-None-Match`（304）、`HEAD`、文本文件 gzip（>1 KB）、正确的 MIME 类型。
- HTML 使用 `Cache-Control: no-cache`；`assets/`、`js/`、`locales/` 及常见静态资源使用 `public, max-age=3600`。
- 静态路径不存在时返回纯文本 `404 Not Found`（不是 JSON）。

## 数据与持久化 / Data & Persistence

```text
data/
├── profiles.json             # id -> {id, nickname, createdAt, updatedAt}
├── records.json              # {"korok":[],"shrines":[],"ganon":[]}
└── saves/
    └── <profile-id>/
        └── <slot>.json       # {data, meta, updatedAt, size}
```

- 写文件采用先写 `*.tmp-<pid>-<timestamp>` 再 `rename` 的原子方式。
- 数据按需加载并驻留内存。文件损坏时会备份为 `*.corrupt-<timestamp>` 并当作空数据继续运行，不会崩溃。
- `data/` 不会通过静态服务器公开。
- 可通过 `DATA_DIR` 指向测试或备份目录。

## 浏览器客户端 / Browser Client

在 `main.html` 中加载 / include in `main.html`:

```html
<script src="js/api.js"></script>
```

`js/api.js` 是普通脚本（非 ES module），暴露 `window.BOTW_API`。服务地址默认取 `location.origin`（HTTP）或 `http://127.0.0.1:8787`（`file://`），可用 `window.BOTW_SERVER = 'http://192.168.1.5:8787'` 覆盖（末尾 `/` 会被移除）。

主要方法 / main methods:

```js
BOTW_API.health()
BOTW_API.config()
BOTW_API.i18n('en')
BOTW_API.profile(id)
BOTW_API.getSave(id, 'auto')
BOTW_API.putSave(id, 'auto', data, meta)
BOTW_API.deleteSave(id, 'auto')
BOTW_API.records('all')
BOTW_API.submitRecord('korok', 'Link', 30)
BOTW_API.stats()

BOTW_API.getProfileId()          // localStorage botw_profile_id，自动生成 link-xxxx
BOTW_API.getNickname()           // 默认 Link
BOTW_API.setNickname('Zelda')
BOTW_API.cloudSave('auto', data) // Promise<boolean>
BOTW_API.cloudLoad('auto')       // Promise<data|null>
BOTW_API.isOnline()
BOTW_API.version                 // "1.0.0"
```

网络请求默认 3.5 秒超时；失败时抛出带 `.code` 的 `Error`（如 `NETWORK`、`TIMEOUT`、`SAVE_NOT_FOUND`）。加载完成（window `load`）后会探测一次 `/api/health`，之后每 60 秒一次，并更新 `BOTW_API.online`、派发事件：

```js
window.addEventListener('botw:net', function (event) {
  console.log(event.detail.online, event.detail.base);
});
```

## 测试 / Tests

```powershell
& "C:\Users\12858\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" server\test.js
```

等价于 / equivalent to:

```bash
npm test
```

测试使用临时 `DATA_DIR`，在随机端口启动服务，覆盖全部接口、静态文件、ETag/304、gzip、路径穿越与错误响应，最后输出 `PASS/FAIL` 并以退出码表示结果。
