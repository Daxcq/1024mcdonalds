/* 两个点餐页面共用的订单确认、支付和售后面板。 */
(function (g) {
  class McdOrders {
    constructor({ api, sessionId, demo, onCreated }) {
      this.api = api; this.sessionId = sessionId; this.demo = demo;
      this.onCreated = onCreated; this.order = null; this.busy = false; this.uncertain = false;
      this.dialog = document.createElement('dialog');
      this.dialog.className = 'mcd-order';
      this.dialog.setAttribute('aria-labelledby', 'orderTitle');
      this.dialog.innerHTML = `
        <header><h2 id="orderTitle">确认订单</h2><button type="button" data-close aria-label="关闭订单面板">×</button></header>
        <div data-summary></div>
        <div data-quote>
          <label class="order-field">取餐方式<select data-way></select></label>
          <p data-mode></p>
          <button class="order-primary" type="button" data-confirm>确认下单</button>
        </div>
        <div data-order hidden>
          <dl><dt>订单号</dt><dd data-id></dd><dt>订单状态</dt><dd data-status></dd><dt>更新时间</dt><dd data-time></dd></dl>
          <a class="order-primary" data-pay target="_blank" rel="noopener noreferrer" hidden>打开官方支付页面</a>
          <p data-pay-hint></p>
          <div class="order-actions"><button type="button" data-refresh>我已支付 / 刷新状态</button><button type="button" data-cancel>取消订单</button></div>
          <fieldset data-reasons hidden><legend>取消这笔真实订单</legend>
            <label class="order-field">取消原因<select data-reason>
              <option value="1">改主意了</option><option value="2">重复下单</option><option value="3">点错了 / 数量不对</option>
              <option value="4">地址 / 电话填错了</option><option value="5">送达时间选错了</option><option value="-1">其它原因</option>
            </select></label>
            <button class="order-danger" type="button" data-cancel-confirm>确认取消订单</button>
          </fieldset>
          <details><summary>查看官方订单详情</summary><pre data-details></pre></details>
        </div>
        <p data-feedback role="status" aria-live="polite"></p>`;
      document.body.appendChild(this.dialog);
      const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/assets/order.css';
      document.head.appendChild(style);
      this.find('[data-close]').onclick = () => this.dialog.close();
      this.find('[data-confirm]').onclick = () => this.confirm();
      this.find('[data-refresh]').onclick = () => this.refresh();
      this.find('[data-cancel]').onclick = () => {
        this.find('[data-reasons]').hidden = false; this.find('[data-reason]').focus();
      };
      this.find('[data-cancel-confirm]').onclick = () => this.cancel();
      this.opener = document.createElement('button'); this.opener.type = 'button'; this.opener.className = 'mcd-order-open';
      this.opener.textContent = '查看真实订单'; this.opener.hidden = true;
      this.opener.onclick = () => this.showSaved(); document.body.appendChild(this.opener);
    }
    find(selector) { return this.dialog.querySelector(selector); }
    message(text, error = false) {
      const box = this.find('[data-feedback]'); box.textContent = text; box.classList.toggle('order-error', error);
    }
    show() { if (!this.dialog.open) this.dialog.showModal(); }
    async run(message, action) {
      if (this.busy) return;
      this.busy = true; this.dialog.setAttribute('aria-busy', 'true'); this.message(message);
      this.dialog.querySelectorAll('button:not([data-close]), select').forEach((el) => { el.disabled = true; });
      try { await action(); }
      catch (e) { this.message(e.message, true); }
      finally {
        this.busy = false; this.dialog.removeAttribute('aria-busy');
        this.dialog.querySelectorAll('button, select').forEach((el) => { el.disabled = false; });
        this.syncButtons();
      }
    }
    syncButtons() {
      this.find('[data-confirm]').disabled = this.busy || this.demo || this.uncertain || !this.quote || !this.quote.takeWayList.length;
      const cannotCancel = this.busy || !this.order || this.order.terminal || this.order.cancel_requested;
      this.find('[data-cancel]').disabled = cannotCancel;
      this.find('[data-cancel-confirm]').disabled = cannotCancel;
    }
    summary(source) {
      const box = this.find('[data-summary]'); box.replaceChildren();
      const store = document.createElement('p'); store.textContent = '门店：' + (source.store.name || source.store.store_code);
      box.appendChild(store);
      for (const line of source.lines) {
        const row = document.createElement('p'); row.textContent = line.name + ' × ' + line.quantity; box.appendChild(row);
      }
      const total = document.createElement('strong'); total.textContent = '应付 ¥' + source.price.toFixed(2); box.appendChild(total);
      if (source.take_way) { const way = document.createElement('p'); way.textContent = '取餐方式：' + source.take_way; box.appendChild(way); }
    }
    showQuote(quote) {
      if (this.order && !this.order.terminal || this.uncertain) { this.showSaved(); return; }
      this.quote = quote; this.summary(quote);
      this.find('#orderTitle').textContent = '确认订单';
      this.find('[data-quote]').hidden = false; this.find('[data-order]').hidden = true;
      const ways = this.find('[data-way]'); ways.replaceChildren();
      for (const way of quote.takeWayList) {
        const option = document.createElement('option'); option.value = String(way.code); option.textContent = way.title; ways.appendChild(option);
      }
      this.find('[data-mode]').textContent = this.demo
        ? '当前是演示模式，仅算价。开启真实下单需在服务端设置 DEMO_MODE=0 并重启。'
        : '点击确认后，将使用已绑定的麦当劳账号创建真实订单。支付需要你在官方页面完成。';
      this.message(quote.takeWayList.length ? '请核对门店、餐品、金额和取餐方式。' : '门店没有返回可用取餐方式，请重新结算或换店。');
      this.syncButtons(); this.show();
    }
    renderOrder(order) {
      this.order = order; this.quote = null; this.opener.hidden = false;
      this.summary(order); this.find('#orderTitle').textContent = '我的真实订单';
      this.find('[data-quote]').hidden = true; this.find('[data-order]').hidden = false;
      this.find('[data-id]').textContent = order.id;
      this.find('[data-status]').textContent = order.status_text;
      this.find('[data-time]').textContent = new Date(order.updated_at).toLocaleString('zh-CN');
      const pay = this.find('[data-pay]'); pay.hidden = !order.pay_url || order.terminal || order.cancel_requested;
      if (!pay.hidden) pay.href = order.pay_url; else pay.removeAttribute('href');
      this.find('[data-pay-hint]').textContent = order.terminal ? '订单已结束。'
        : order.cancel_requested ? '取消请求已提交，请刷新状态确认最终结果。'
        : order.pay_url ? '支付后请刷新订单状态，实际支付结果以麦当劳官方为准。' : '接口未返回支付链接，可在麦当劳 App 查看并支付这笔订单。';
      this.find('[data-details]').textContent = JSON.stringify(order.data, null, 2);
      this.find('[data-reasons]').hidden = true; this.syncButtons();
    }
    showSaved() {
      if (this.order) this.renderOrder(this.order);
      if (this.uncertain) {
        this.find('#orderTitle').textContent = '请核实下单结果';
        this.find('[data-quote]').hidden = true; this.find('[data-order]').hidden = !this.order;
        this.message('上次下单结果不确定，请先到麦当劳 App 查看订单，不要重复下单。', true);
      }
      this.show();
    }
    async restore() {
      const r = await this.api('/api/order?session_id=' + encodeURIComponent(this.sessionId()));
      this.uncertain = r.uncertain;
      if (r.order) this.renderOrder(r.order);
      this.opener.hidden = !(r.order || r.uncertain || r.busy);
    }
    async confirm() {
      if (this.demo || !this.quote || this.uncertain) return;
      const quote = this.quote;
      await this.run('正在创建订单，请勿重复提交…', async () => {
        let r;
        try {
          r = await this.api('/api/order/confirm', { session_id: this.sessionId(), quote_id: quote.quote_id, take_way_code: this.find('[data-way]').value });
        } catch (e) {
          // 请求可能已经到达服务端, 先读取本地订单记录, 不重发 create-order。
          try {
            await this.restore();
            if (this.order && this.order.quote_id === quote.quote_id) {
              this.renderOrder(this.order); if (this.onCreated) this.onCreated();
              this.message('订单已创建，请刷新状态后完成支付。'); return;
            }
          } catch (_) {}
          // 无法确定服务端是否已执行时, 当前页面也禁止重复确认。
          if (!e.status || e.status >= 500) {
            this.uncertain = true; this.opener.hidden = false;
            this.message(e.message + ' 请先到麦当劳 App 核实订单，不要重复下单。', true); return;
          }
          throw e;
        }
        this.renderOrder(r.order_state); if (this.onCreated) this.onCreated();
        this.message('订单已创建，请通过官方支付链接完成支付。');
      });
    }
    async refresh() {
      await this.run('正在查询麦当劳订单状态…', async () => {
        const r = await this.api('/api/order/status?session_id=' + encodeURIComponent(this.sessionId()));
        this.renderOrder(r.order); this.message('已获取最新订单状态。');
      });
    }
    async cancel() {
      if (!this.order || this.order.terminal || this.order.cancel_requested) return;
      await this.run('正在申请取消订单…', async () => {
        const r = await this.api('/api/order/cancel', { session_id: this.sessionId(), order_id: this.order.id, reason_code: this.find('[data-reason]').value });
        this.renderOrder(r.order); this.message(r.warning || r.message, !!r.warning);
      });
    }
  }
  g.McdOrders = McdOrders;
})(typeof window !== 'undefined' ? window : globalThis);
