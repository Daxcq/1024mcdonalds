# 麦当劳 MCP 集成说明 (MCP_INTEGRATION)

## 一、接入的 MCP Server

本项目接入麦当劳中国官方 MCP Server：

- **服务地址**：`https://mcp.mcd.cn`
- **传输协议**：Streamable HTTP（基于官方 `mcp.client.streamable_http` 客户端）
- **认证方式**：`Authorization: Bearer <MCD_MCP_TOKEN>`

在 [`app/mcd_client.py`](./app/mcd_client.py) 中实现了带懒连接、断线自动重连、超时保护以及写操作安全闸门（`WRITE_TOOLS`）的异步客户端封装。

## 二、实际使用的 MCP Tools

项目在点餐页面、AI 店员「小麦」对话、汉堡工坊及订单管理流程中实际调用了以下麦当劳 MCP 工具：

| 工具名称 (Tool) | 用途说明 | 调用场景与模块 |
|---|---|---|
| `query-meals` | 查询指定门店与取餐方式下的实时在售菜单、分类与餐品价格 | 门店切换、自动选店探测（`app/autostore.py`）、菜单加载（`app/menu.py`）、AI 菜单检索（`app/tools.py`） |
| `query-meal-detail` | 查询指定餐品（特别是套餐）的详细组成、随餐卡槽及加价规则 | 套餐规格选择、AI 店员为您搭配套餐（`app/tools.py`、`app/order_api.py`） |
| `calculate-price` | 根据门店、取餐方式及购物车餐品列表计算官方实时总价与明细 | 购物车结算算价、AI 助手预算校验与算价（`app/tools.py`、`app/order_api.py`） |
| `list-nutrition-foods` | 获取麦当劳官方餐品营养成分数据（热量、蛋白质、脂肪、碳水等） | AI 店员「小麦」回答减脂、高蛋白、热量控制等营养咨询（`app/tools.py`） |
| `now-time-info` | 获取当前标准时间与时段信息 | 判断早餐/正餐时段及门店营业时间校验 |
| `create-order` | 创建真实麦当劳订单并返回官方支付跳转信息 | 用户在开启真实下单模式并人工确认结算后调用（`app/order_api.py`，受 `allow_write=True` 保护） |
| `query-order` | 查询已创建订单的实时状态与详情 | 订单确认页刷新支付及制作状态（`app/order_api.py`） |
| `cancel-order` | 申请取消未完成支付或符合取消条件的订单 | 订单面板人工触发取消订单（`app/order_api.py`，受 `allow_write=True` 保护） |

## 三、调用流程

1. **门店选择与菜单加载**：
   - 用户进入首页选择门店（或触发自动选店），后端调用 `query-meals` 拉取该门店实时菜单，并缓存至会话中。
2. **点餐交互与后厨动画联动**：
   - **手动点餐 / 汉堡工坊**：用户在菜单或汉堡工坊挑选餐品，若涉及套餐则调用 `query-meal-detail` 解析套餐选项，加入购物车的同时驱动前端 Canvas 后厨实时制作动画。
   - **AI 店员「小麦」对话**：用户通过自然语言提出需求（如“35元以内高蛋白晚餐”），AI 助手组合调用 `list-nutrition-foods`、本地菜单检索及 `query-meal-detail`，自动更新购物车并同步触发后厨备餐动画。
3. **实时算价（`calculate-price`）**：
   - 用户点击“去结算”或让 AI 算价时，后端将购物车商品编码组装为标准结构调用 `calculate-price`，向用户展示麦当劳官方接口返回的准确应付金额。
4. **安全确认与订单闭环（`create-order` / `query-order` / `cancel-order`）**：
   - 默认 `DEMO_MODE=1` 仅体验至算价环节。当显式配置 `DEMO_MODE=0` 并由用户在前端点击“确认下单”时，服务端才放行 `allow_write=True` 调用 `create-order`，生成订单并引导用户前往官方渠道完成支付，后续可通过 `query-order` 刷新状态或调用 `cancel-order` 取消。

## 四、业务价值与创新点

- **把抽象的工具调用转化为具象的视觉体验**：传统 MCP 调用停留在聊天框文本回复，本项目将麦当劳 MCP 的菜单、配方、算价与下单能力同**可视化后厨实时动画**、**汉堡配料工坊**深度融合，让每一次加购和 AI 推荐都有即时的视觉反馈。
- **自然语言 + 图形界面双模协同**：既能用 AI 店员「小麦」结合 `list-nutrition-foods` 与 `calculate-price` 解决“吃什么、怎么搭更划算/更健康”的决策难题，又能随时在图形界面微调购物车。
- **严格的写操作安全边界**：将只读查询工具与涉及真实资金/订单的写工具（`create-order` 等）在客户端底层隔离，AI 仅负责推荐、加购与算价，真实下单必须经过用户显式确认，兼顾创新体验与交易安全。
