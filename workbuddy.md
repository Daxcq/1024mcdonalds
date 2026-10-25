# WorkBuddy 开发上下文记录 (workbuddy.md)

本项目使用 WorkBuddy 协助完成架构梳理、麦当劳 MCP 联调、汉堡工坊页面跳转修复、订单确认流优化及云端沙箱部署验证。

## 1. 麦当劳 MCP 接入与订单链路调优

- **目标**：基于麦当劳官方 MCP（`https://mcp.mcd.cn`）完成真实门店选店、实时菜单加载、算价与订单状态流转，并与前端后厨动画及 AI 店员「小麦」联动。
- **实现记录**：
  - 在 `app/mcd_client.py` 中使用 `streamablehttp_client` 建立连接，设置 `WRITE_TOOLS` 写操作闸门，将 AI 店员工具限制在只读检索与 `calculate-price` 算价，真实下单 `create-order` 与 `cancel-order` 仅由服务端确认接口触发。
  - 在 `app/server.py` 中选店后结合本地门店表补全门店名称，在 `app/order_api.py` 中完善订单状态字段解析与 `paid` 判定，捕获异步取消异常。
  - 前端 `index.html`、`js/ui.js`、`js/orders.js` 完成算价单展示、官方支付跳转与订单状态轮询刷新。

## 2. 汉堡工坊与主站路由协同

- **问题排查**：在云端环境跨页跳转 `/workshop`（汉堡工坊）与返回首页 `/` 时，查询参数丢失会导致页面访问受阻。
- **修复验证**：
  - 更新 `js/npc.js` 与 `static/burger-workshop.html`，在页面跳转时保留 `location.search`，并在 Node 环境与本地服务完成回归验证。

## 3. 安全门控与部署验证

- **安全设计**：针对敏感操作（`/api/order/confirm`、`/api/order/cancel`、`/api/chat`）在 `app/server.py` 中增加 `ACCESS_KEY` 校验中间件（常数时间比较 `hmac.compare_digest`），浏览菜单、选店、算价与汉堡工坊保持免口令畅通体验。
- **端到端验证**：
  - `POST /api/session` → `POST /api/store`（MCP 选店并拉取菜单）→ `POST /api/chat`（AI 店员工具调用与配餐推荐）→ `POST /api/order/checkout`（MCP 实时算价返回 `quote_id`）全链路测试通过。
