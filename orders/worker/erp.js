'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const view = byId('erp-view');
  if (!view) return;

  const search = byId('erp-search');
  const list = byId('erp-list');
  const detail = byId('erp-detail');
  const dialog = byId('erp-order-dialog');
  const form = byId('erp-order-form');
  const fields = byId('erp-order-fields');
  const lines = byId('erp-lines');
  const submit = byId('erp-save-order');
  const dateFrom = byId('erp-date-from');
  const dateTo = byId('erp-date-to');
  const statusFilter = byId('erp-status-filter');
  const paymentFilter = byId('erp-payment-filter');
  const shippingFilter = byId('erp-shipping-filter');
  const orderStates = ['접수','처리 중','완료','취소'];
  const paymentStates = ['미결제','부분 결제','결제 완료'];
  const shippingStates = ['출고 대기','부분 출고','출고 완료'];
  const numberFormat = new Intl.NumberFormat('ko-KR');
  const dateFormat = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  const money = amount => numberFormat.format(amount) + '원';
  const count = amount => numberFormat.format(amount) + '건';
  const base = () => window.erpData;
  let data = {orders:[],items:[],shipments:[],feedback:[],services:[]};
  let cache = {};
  let selectedId = null;
  let related = null;
  let editing = null;
  let refreshing = null;
  let waiting = false;
  let deletingOrder = false;
  let ready = false;

  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  function button(text, action, className) {
    const el = node('button',text,className);
    el.type = 'button';
    el.addEventListener('click',action);
    return el;
  }

  function appendOptions(select, choices, label) {
    select.replaceChildren();
    if (label) select.add(new Option(label,''));
    for (const entry of choices) {
      const [text,value] = Array.isArray(entry) ? entry : [entry,entry];
      select.add(new Option(text,value));
    }
  }

  appendOptions(statusFilter,orderStates,'전체');
  appendOptions(paymentFilter,paymentStates,'전체');
  appendOptions(shippingFilter,shippingStates,'전체');

  function mapRows(rows, attribute) {
    const result = new Map();
    for (const row of rows) {
      const group = result.get(row[attribute]) ?? [];
      group.push(row);
      result.set(row[attribute],group);
    }
    return result;
  }

  function setCache() {
    const records = base().getRecords();
    cache = {
      customers: new Map(records.customers.map(customer => [customer.id,customer])),
      extracts: new Map(records.extracts.map(record => [record.id,record])),
      items: mapRows(data.items,'order_id'),
      shipments: mapRows(data.shipments,'order_item_id'),
      feedback: mapRows(data.feedback,'order_id'),
      services: mapRows(data.services,'order_id')
    };
  }

  function metrics(order) {
    const items = cache.items.get(order.id) ?? [];
    const shipments = items.flatMap(item => cache.shipments.get(item.id) ?? []);
    const sum = items.reduce((total,item) => total + lineAmount(item),0);
    const total = sum - order.discount + order.shipping_fee;
    const balance = Math.max(0,total - order.paid_amount);
    const quantity = items.reduce((value,item) => value + item.quantity,0);
    const shipped = shipments.reduce((value,item) => value + item.quantity,0);
    return {
      items,shipments,sum,total,balance,quantity,shipped,
      payment:balance === 0 ? paymentStates[2] : order.paid_amount ? paymentStates[1] : paymentStates[0],
      shipping:shipped >= quantity && quantity > 0 ? shippingStates[2] : shipped ? shippingStates[1] : shippingStates[0]
    };
  }

  function lineAmount(item) {
    return item.quantity * item.unit_price;
  }

  function byMetricTone(state) {
    if (['완료','결제 완료','출고 완료'].includes(state)) return 'success';
    if (['미결제','부분 결제','출고 대기','부분 출고','처리 중'].includes(state)) return 'warning';
    if (state === '취소') return 'neutral';
    return '';
  }

  function tag(value) {
    const indicator = node('span',value,'erp-tag');
    indicator.dataset.tone = byMetricTone(value);
    return indicator;
  }

  function renderTotals(rows) {
    const live = rows.filter(({order}) => order.status !== '취소');
    byId('erp-total-count').textContent = count(rows.length);
    byId('erp-open-payment').textContent = money(live.reduce((total,row) => total + row.balance,0));
    byId('erp-open-shipping').textContent = count(live.filter(row => row.shipped < row.quantity).length);
    byId('erp-order-total').textContent = money(live.reduce((total,row) => total + row.total,0));
  }

  function renderScope() {
    const target = byId('erp-scope');
    target.hidden = !related;
    target.replaceChildren();
    if (!related) return;
    const label = related.kind === 'customer' ? cache.customers.get(related.id)?.name : cache.extracts.get(related.id)?.title;
    target.append(node('span',(related.kind === 'customer' ? '고객 ' : '추출 기록 ') + (label || '선택됨')));
    target.append(button('필터 해제',() => { related = null; render(); }));
  }

  function orderText(order, row) {
    const customer = cache.customers.get(order.customer_id);
    const extracts = row.shipments.map(shipment => cache.extracts.get(shipment.extract_id)).filter(Boolean);
    return [
      order.order_no,order.customer_name,order.customer_phone,order.channel,order.note,order.address,
      customer?.name,customer?.phone,customer?.phone?.replace(/\D/g,''),
      ...row.items.flatMap(item => [item.name,item.sku,item.note]),
      ...extracts.flatMap(record => [record.title,record.source,JSON.stringify(Object.fromEntries(
        Object.entries(record.data).filter(([key]) => key !== '__erp_png')))])
    ].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR');
  }

  function matchOrder(order, row, words) {
    if (related?.kind === 'customer' && order.customer_id !== related.id) return false;
    if (related?.kind === 'extract' && !row.shipments.some(shipment => shipment.extract_id === related.id)) return false;
    if (dateFrom.value && order.ordered_on < dateFrom.value) return false;
    if (dateTo.value && order.ordered_on > dateTo.value) return false;
    if (statusFilter.value && order.status !== statusFilter.value) return false;
    if (paymentFilter.value && row.payment !== paymentFilter.value) return false;
    if (shippingFilter.value && row.shipping !== shippingFilter.value) return false;
    if (!words.length) return true;
    const haystack = orderText(order,row);
    return words.every(word => haystack.includes(word));
  }

  function showEmptyDetail() {
    detail.replaceChildren(node('h2','주문 상세'),node('p','목록에서 주문을 선택하세요.','empty'));
  }

  function renderList(rows) {
    list.replaceChildren();
    const trimmed = search.value.trim().toLocaleLowerCase('ko-KR');
    const words = trimmed ? trimmed.split(/\s+/) : [];
    const filtered = rows.filter(row => matchOrder(row.order,row,words));
    byId('erp-match-count').textContent = count(filtered.length) + ' 표시';
    if (!filtered.length) {
      const message = ready ? (rows.length ? '조건에 맞는 주문이 없습니다.' : '등록된 주문이 없습니다.') : '주문을 불러오는 중입니다.';
      list.append(node('p',message,'empty'));
    }
    for (const row of filtered) {
      const {order} = row;
      const block = node('div',undefined,'erp-order-row');
      block.setAttribute('aria-current',String(selectedId === order.id));
      const heading = node('div',undefined,'erp-order-row-head');
      const title = order.order_no + ' · ' + customerName(order);
      heading.append(button(title,() => { selectOrder(order.id); },'text-button'),node('strong',money(row.total)));
      const itemLabel = row.items[0]?.name ?? '상품 없음';
      block.append(heading,node('p',order.ordered_on + ' · ' + itemLabel + (row.items.length > 1 ? ' 외 ' + (row.items.length - 1) + '종' : ''),'muted'));
      const tags = node('div',undefined,'erp-order-meta');
      tags.append(tag(order.status),tag(row.payment),tag(row.shipping));
      const remove = button('삭제',event => removeOrder(order,event.currentTarget),'erp-delete-order');
      remove.setAttribute('aria-label',order.order_no + ' 삭제');
      tags.append(remove);
      block.append(tags);
      list.append(block);
    }
  }

  function customerName(order) {
    return order.customer_name || cache.customers.get(order.customer_id)?.name || '고객';
  }

  async function removeOrder(order, control) {
    if (deletingOrder || !window.confirm(order.order_no + ' 주문을 삭제할까요?\n\n' +
      '주문 상품, 출고, 만족도, A/S 내역도 함께 삭제됩니다. 고객 정보와 추출 기록은 보관됩니다.')) return;
    deletingOrder = true;
    control.disabled = true;
    try {
      await base().api('erp/remove',{kind:'orders',id:order.id,revision:order.revision});
      if (selectedId === order.id) selectedId = null;
      data.orders = data.orders.filter(entry => entry.id !== order.id);
      render();
      try {
        await reload();
        base().notice('주문을 삭제했습니다.');
      } catch {
        base().notice('주문을 삭제했습니다. 최신 목록을 보려면 주문 탭을 다시 열어 주세요.',true);
      }
      search.focus();
    } catch (error) {
      base().notice(error.message,true);
    } finally {
      deletingOrder = false;
      control.disabled = false;
    }
  }

  function selectOrder(id, moveFocus = true) {
    selectedId = id;
    render();
    if (moveFocus) {
      detail.focus({preventScroll:true});
      if (matchMedia('(max-width:760px)').matches) detail.scrollIntoView({block:'start'});
    }
  }

  function addDefinition(target, name, value, isWide = false) {
    const item = node('div',undefined,isWide ? 'erp-full' : '');
    const content = node('dd');
    if (value instanceof Node) content.append(value);
    else content.textContent = String(value ?? '') || '미입력';
    item.append(node('dt',name),content);
    target.append(item);
  }

  function renderProducts(target, row) {
    const section = node('section',undefined,'divider');
    section.append(node('h3','주문 상품'));
    const wrapper = node('div',undefined,'erp-table-wrap');
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role','region');
    wrapper.setAttribute('aria-label','주문 상품 표');
    const table = node('table');
    table.setAttribute('aria-label','주문 상품');
    const header = table.createTHead().insertRow();
    for (const [index,name] of ['상품명 · 코드','수량','단가','금액','출고 수량'].entries()) {
      const cell = node('th',name);
      cell.scope = 'col';
      if (index > 0) cell.dataset.number = '';
      header.append(cell);
    }
    const body = table.createTBody();
    for (const item of row.items) {
      const line = body.insertRow();
      const label = line.insertCell();
      label.append(node('strong',item.name));
      if (item.sku) label.append(node('p',item.sku,'muted'));
      if (item.note) label.append(node('p',item.note,'muted erp-multiline'));
      const shipped = (cache.shipments.get(item.id) ?? []).reduce((total,shipment) => total + shipment.quantity,0);
      const values = [numberFormat.format(item.quantity),money(item.unit_price),money(lineAmount(item)),numberFormat.format(shipped)];
      for (const value of values) {
        const cell = line.insertCell();
        cell.textContent = value;
        cell.dataset.number = '';
      }
    }
    wrapper.append(table);
    section.append(wrapper);
    target.append(section);
  }

  function renderDetail(row) {
    const {order,items,shipments} = row;
    detail.replaceChildren();
    const header = node('div',undefined,'detail-head');
    const title = node('div');
    title.append(node('h2',order.order_no));
    const states = node('div',undefined,'erp-order-meta');
    states.append(tag(order.status),tag(row.payment),tag(row.shipping));
    title.append(states);
    header.append(title,button('주문 수정',() => openEditor(order),'primary'));
    detail.append(header);

    const definitions = node('dl',undefined,'contact');
    const customer = cache.customers.get(order.customer_id);
    const label = customerName(order);
    addDefinition(definitions,'고객',customer ? button(label,() => base().openCustomer(order.customer_id),'text-button') : label);
    addDefinition(definitions,'주문일',order.ordered_on);
    addDefinition(definitions,'연락처',order.customer_phone ?? customer?.phone);
    addDefinition(definitions,'주문 채널',order.channel);
    addDefinition(definitions,'결제 방식',order.payment_method);
    addDefinition(definitions,'배송 주소',order.address,true);
    if (order.note) addDefinition(definitions,'주문 메모',order.note,true);
    detail.append(definitions);

    const payment = node('dl',undefined,'erp-amounts');
    for (const [label,value] of [
      ['상품 합계',row.sum],['할인',order.discount],['배송비',order.shipping_fee],['주문 금액',row.total],
      ['입금액',order.paid_amount],['미결제 금액',row.balance]
    ]) addDefinition(payment,label,money(value));
    if (order.paid_amount > row.total) addDefinition(payment,'초과 입금',money(order.paid_amount - row.total));
    detail.append(payment);
    renderProducts(detail,row);

    const services = node('div');
    detail.append(services);
    window.erpService?.render(services,{
      order,items,shipments,feedback:cache.feedback.get(order.id) ?? [],services:cache.services.get(order.id) ?? [],
      extracts:[...cache.extracts.values()],reload
    });
  }

  function render() {
    setCache();
    const rows = data.orders.map(order => ({order,...metrics(order)}));
    renderTotals(rows);
    renderScope();
    renderList(rows);
    const selected = rows.find(row => row.order.id === selectedId);
    if (selected) renderDetail(selected);
    else showEmptyDetail();
  }

  function resetFilters() {
    for (const input of [search,dateFrom,dateTo,statusFilter,paymentFilter,shippingFilter]) input.value = '';
    related = null;
  }

  async function reload() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      data = await base().api('erp');
      ready = true;
      render();
    })();
    try { await refreshing; }
    finally { refreshing = null; }
  }

  async function activate() {
    render();
    try { await reload(); }
    catch (error) {
      byId('erp-match-count').textContent = '주문 조회 실패';
      if (!ready) list.replaceChildren(node('p','주문을 불러오지 못했습니다. 주문 탭을 다시 열어 주세요.','empty'));
      base().notice(error.message,true);
    }
  }

  function field(name, label, settings = {}) {
    const wrapper = node('label',label,settings.wide ? 'erp-full' : '');
    const field = node(settings.tag ?? 'input');
    field.name = name;
    if (settings.type) field.type = settings.type;
    if (settings.required) field.required = true;
    if (settings.maxLength !== undefined) field.maxLength = settings.maxLength;
    if (settings.min !== undefined) field.min = settings.min;
    if (settings.max !== undefined) field.max = settings.max;
    if (settings.placeholder) field.placeholder = settings.placeholder;
    if (settings.tag === 'textarea') field.rows = 2;
    if (settings.choices) appendOptions(field,settings.choices,settings.prompt);
    field.value = settings.value ?? '';
    wrapper.append(field);
    return [wrapper,field];
  }

  function addField(target,name,label,settings) {
    const [wrapper,input] = field(name,label,settings);
    target.append(wrapper);
    return input;
  }

  function adjustLines() {
    const rows = [...lines.children];
    rows.forEach((el,index) => {
      el.querySelector('legend').textContent = '상품 ' + (index + 1);
      el.querySelector('button').disabled = rows.length <= 1 || el.dataset.locked === 'true';
    });
    byId('erp-add-line').disabled = rows.length >= 100;
    showFormTotals();
  }

  function addLine(item = {}) {
    const section = node('fieldset',undefined,'erp-line');
    if (item.id) section.dataset.id = item.id;
    const shipped = Boolean(cache.shipments.get(item.id)?.length);
    const serviced = Boolean(item.id && (cache.services.get(editing?.id) ?? []).some(record => record.order_item_id === item.id));
    section.dataset.locked = String(shipped || serviced);
    section.append(node('legend','상품'));
    const grid = node('div',undefined,'erp-fields');
    const name = addField(grid,'name','상품명',{required:true,maxLength:200,value:item.name});
    const sku = addField(grid,'sku','상품 코드',{maxLength:100,value:item.sku});
    name.readOnly = shipped;
    sku.readOnly = shipped;
    addField(grid,'quantity','수량',{type:'number',required:true,min:1,max:1000000,value:item.quantity ?? 1});
    addField(grid,'unit_price','단가 (원)',{type:'number',required:true,min:0,max:1000000000000,value:item.unit_price ?? 0});
    addField(grid,'note','상품 메모',{tag:'textarea',wide:true,maxLength:1000,value:item.note});
    const actions = node('div',undefined,'actions');
    actions.append(button('상품 삭제',() => { section.remove(); adjustLines(); }));
    section.append(grid,actions);
    lines.append(section);
    adjustLines();
    return name;
  }

  function currentItems() {
    return [...lines.children].map(line => {
      const fields = Object.fromEntries([...line.querySelectorAll('input,textarea')].map(input => [input.name,input.value]));
      return {
        ...(line.dataset.id ? {id:line.dataset.id} : {}), ...fields,
        quantity:Number(fields.quantity),unit_price:Number(fields.unit_price)
      };
    });
  }

  function showFormTotals() {
    const meta = new FormData(form);
    const sum = currentItems().reduce((total,item) => total + lineAmount(item),0);
    const due = sum - Number(meta.get('discount')) + Number(meta.get('shipping_fee'));
    byId('erp-form-totals').textContent = '상품 합계 ' + money(sum) + ' · 주문 금액 ' + money(due) +
      ' · 미결제 ' + money(Math.max(0,due - Number(meta.get('paid_amount'))));
  }

  function openEditor(order = null, customerId = null) {
    const customers = [...base().getRecords().customers].sort((a,b) => a.name.localeCompare(b.name,'ko'));
    if (!customers.length) {
      base().notice('고객 탭에서 고객을 먼저 등록해 주세요.',true);
      return false;
    }
    editing = order;
    fields.replaceChildren();
    lines.replaceChildren();
    byId('erp-order-dialog-title').textContent = order ? '주문 수정' : '주문 등록';
    setError('');
    const customer = addField(fields,'customer_id','고객',{
      tag:'select',required:true,prompt:'고객 선택',value:order?.customer_id ?? customerId,
      choices:customers.map(item => [item.name + (item.phone ? ' · ' + item.phone : ''),item.id])
    });
    if (order) {
      const hasHistory = metrics(order).shipments.length || cache.feedback.get(order.id)?.length || cache.services.get(order.id)?.length;
      customer.disabled = Boolean(hasHistory);
    }
    addField(fields,'ordered_on','주문일',{type:'date',required:true,value:order?.ordered_on ?? dateFormat.format(new Date())});
    addField(fields,'status','주문 상태',{tag:'select',choices:orderStates,value:order?.status ?? orderStates[0]});
    addField(fields,'channel','주문 채널',{maxLength:100,placeholder:'예: 방문, 전화, 메신저',value:order?.channel});
    const address = addField(fields,'address','배송 주소',{tag:'textarea',wide:true,maxLength:500,
      value:order?.address ?? cache.customers?.get(customer.value)?.address});
    customer.addEventListener('change',() => {
      const record = customers.find(item => item.id === customer.value);
      if (!address.value || !order) address.value = record?.address ?? '';
    });
    addField(fields,'payment_method','결제 방식',{maxLength:80,placeholder:'예: 카드, 계좌이체',value:order?.payment_method});
    for (const [name,label] of [['paid_amount','입금액 (원)'],['discount','할인 (원)'],['shipping_fee','배송비 (원)']]) {
      addField(fields,name,label,{type:'number',required:true,min:0,max:1000000000000,value:order?.[name] ?? 0});
    }
    addField(fields,'note','주문 메모',{tag:'textarea',wide:true,maxLength:1000,value:order?.note});
    for (const item of order ? cache.items.get(order.id) ?? [{}] : [{}]) addLine(item);
    showFormTotals();
    dialog.showModal();
    (customer.disabled ? fields.querySelector('[name=ordered_on]') : customer).focus();
    return true;
  }

  function setError(text) {
    const el = form.querySelector('.form-error');
    el.textContent = text;
    el.hidden = !text;
  }

  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (waiting) return;
    const values = Object.fromEntries([...fields.querySelectorAll('input,textarea,select')].map(input => [input.name,input.value]));
    const {customer_id,ordered_on,status,channel,address,note,discount,shipping_fee,paid_amount,payment_method} = values;
    const body = {
      customer_id,ordered_on,status,channel,address,note,payment_method,
      discount:Number(discount),shipping_fee:Number(shipping_fee),paid_amount:Number(paid_amount),items:currentItems(),
      ...(editing ? {id:editing.id,revision:editing.revision} : {})
    };
    const sum = body.items.reduce((total,item) => total + lineAmount(item),0);
    if (!Number.isSafeInteger(sum + body.shipping_fee)) {
      setError('주문 금액이 너무 큽니다. 수량과 단가를 확인해 주세요.');
      return;
    }
    if (body.discount > sum + body.shipping_fee) {
      setError('할인은 상품 금액에 배송비를 더한 금액 이하로 입력하세요.');
      return;
    }
    setError('');
    waiting = true;
    submit.disabled = true;
    try {
      const result = await base().api('erp/orders',body);
      dialog.close();
      selectedId = result.id;
      resetFilters();
      try { await reload(); }
      catch (error) {
        base().notice('주문을 저장했습니다. 목록을 다시 열어 주세요.',true);
        return;
      }
      selectOrder(result.id);
      base().notice('주문을 저장했습니다.');
    } catch (error) { setError(error.message); }
    finally { waiting = false; submit.disabled = false; }
  });

  search.addEventListener('input',render);
  for (const input of [dateFrom,dateTo,statusFilter,paymentFilter,shippingFilter]) input.addEventListener('change',render);
  byId('erp-reset').addEventListener('click',() => { resetFilters(); render(); });
  byId('erp-add-order').addEventListener('click',() => openEditor());
  byId('erp-add-line').addEventListener('click',() => addLine().focus());
  byId('erp-close-order').addEventListener('click',() => { if (!waiting) dialog.close(); });
  dialog.addEventListener('cancel',event => { if (waiting) event.preventDefault(); });
  form.addEventListener('input',showFormTotals);

  window.erpUi = {
    activate,
    reload,
    refreshCustomerLabels:render,
    async openOrder(id) {
      if (!ready || !data.orders.some(order => order.id === id)) await activate();
      resetFilters();
      selectOrder(id);
    },
    openNewOrder(customerId) { setCache(); return openEditor(null,customerId); },
    async openRelated(kind,id) {
      if (!ready) await activate();
      resetFilters();
      related = {kind,id};
      selectedId = null;
      render();
    }
  };
})();
