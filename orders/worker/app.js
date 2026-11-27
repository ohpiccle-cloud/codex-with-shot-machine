'use strict';

const byId = id => document.getElementById(id);
const customerForm = byId('customer-form');
const extractForm = byId('extract-form');
const linkForm = byId('link-form');
const search = byId('search');
let records = {customers:[],extracts:[],customer_extracts:[]};
let tab = 'orders', selected = null, customerId = null, linkCustomerId = null;
let previewRecords = [], source = '', selectedPng = '';
let fileVersion = 0, busy = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, handler, className) {
  const el = node('button',text,className);
  el.type = 'button';
  el.addEventListener('click',handler);
  return el;
}

function extractFields(data) {
  return Object.entries(data).filter(([key]) => !['__erp_png', '__shot_filename'].includes(key));
}

function pngUrl(base64) {
  return 'data:image/png;base64,' + base64;
}

function notice(text, error = false) {
  const el = byId('notice');
  el.textContent = text;
  el.hidden = !text;
  el.dataset.error = String(error);
}

function formError(form, text) {
  const el = form.querySelector('.form-error');
  el.textContent = text;
  el.hidden = !text;
}

async function copyShippingDetails(customer) {
  const text = [customer.name, customer.phone, customer.address]
    .map(value => value.trim()).filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    notice('받는 분 이름, 연락처, 주소를 복사했습니다.');
  } catch {
    notice('클립보드에 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.',true);
  }
}

async function api(url, body) {
  const options = body === undefined ? {} : {
    method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(body)
  };
  const response = await fetch('/orders/api/' + url,options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '서버에 연결할 수 없습니다. 다시 시도하세요.');
  return data;
}

async function refresh() {
  const [stored, history] = await Promise.all([
    api('records'),
    fetch('/api/extractions').then(response => {
      if (!response.ok) throw new Error('추출 히스토리를 불러오지 못했습니다.');
      return response.json();
    }),
  ]);
  const registered = new Set(stored.extracts.map(record => record.id));
  const historyByFile = new Map(history.records.map(record => [record.filename, record]));
  const historyOnly = history.records.filter(record => !registered.has(record.orderExtractId)).map(record => ({
    id: record.orderExtractId,
    title: record.title || record.filename.replace(/\.png$/, ''),
    source: record.filename,
    created_at: record.date,
    history: record,
    data: { __shot_filename: record.filename },
    historyOnly: true,
  }));
  const savedExtracts = stored.extracts.map(record => {
    const local = historyByFile.get(record.data.__shot_filename);
    return local ? { ...record, title: local.title || record.title, history: local } : record;
  });
  const sortDate = record => record.history?.date ?? record.created_at.slice(0,10);
  const sortTime = record => record.history?.timestamp ?? Date.parse(record.created_at) / 1000;
  const ordered = [...historyOnly, ...savedExtracts].sort((a,b) =>
    sortDate(b).localeCompare(sortDate(a)) || sortTime(b) - sortTime(a)
    || (b.history?.number ?? 0) - (a.history?.number ?? 0));
  records = { ...stored, extracts: ordered };
  render();
}

async function registerExtract(id) {
  const record = records.extracts.find(extract => extract.id === id);
  if (record?.historyOnly) {
    const result = await api('shot-extract', { filename: record.source });
    return result.id;
  }
  return id || null;
}

function showTab(next, id = null) {
  tab = next;
  selected = id;
  search.value = '';
  render();
  if (next === 'orders') return window.erpUi.activate();
}

async function showRelatedOrders(kind, id) {
  try {
    await showTab('orders');
    await window.erpUi.openRelated(kind,id);
  } catch (error) { notice(error.message,true); }
}

function select(id) {
  selected = id;
  render();
  if (matchMedia('(max-width:650px)').matches) byId('detail').scrollIntoView({block:'start'});
}

function render() {
  const customerView = tab === 'customers';
  const orderView = tab === 'orders';
  byId('order-tab').setAttribute('aria-pressed',String(orderView));
  byId('customer-tab').setAttribute('aria-pressed', String(customerView));
  byId('extract-tab').setAttribute('aria-pressed', String(tab === 'extracts'));
  byId('customer-count').textContent = records.customers.length;
  byId('extract-count').textContent = records.extracts.length;
  byId('records-view').hidden = orderView;
  byId('erp-view').hidden = !orderView;
  if (orderView) return;
  byId('list-title').textContent = customerView ? '고객 목록' : '추출 기록';
  byId('add-customer').hidden = !customerView;
  search.placeholder = customerView ? '이름 또는 연락처 검색' : '기록 이름, 출처 또는 내용 검색';
  search.setAttribute('aria-label',search.placeholder);
  const q = search.value.trim().toLowerCase();
  const digits = /^[\d+ .()-]+$/.test(q) ? q.replace(/\D/g,'') : '';
  const visible = records[tab].filter(record => {
    const fields = customerView ? [record.name,record.phone] : [record.title,record.source,JSON.stringify(extractFields(record.data))];
    return fields.some(value => value.toLowerCase().includes(q)) ||
      (customerView && digits && record.phone.replace(/\D/g,'').includes(digits));
  });
  const list = byId('list');
  list.replaceChildren();
  if (!visible.length) list.append(node('p',q ? '검색 결과가 없습니다.' :
    customerView ? '등록된 고객이 없습니다.' : '추가된 추출 기록이 없습니다.','empty'));
  for (const record of visible) {
    const el = button(customerView ? record.name : record.title,() => select(record.id),'record-button');
    el.setAttribute('aria-current',String(selected === record.id));
    const sub = customerView ? record.phone : record.source || record.created_at.slice(0,10);
    if (sub) el.append(node('small',sub));
    list.append(el);
  }
  const record = records[tab].find(item => item.id === selected);
  const detail = byId('detail');
  detail.replaceChildren();
  if (record) renderDetail(detail,record,customerView);
  else {
    detail.append(node('h2',customerView ? '고객 상세' : '추출 기록 상세'));
    detail.append(node('p',customerView ? '고객을 선택하면 고객 정보와 연결된 추출 기록이 표시됩니다.' :
      '추출 기록을 선택하면 원본 항목과 연결된 고객이 표시됩니다.','empty'));
  }
}

function renderDetail(detail, record, customerView) {
  const header = node('div',undefined,'detail-head');
  detail.append(header);
  if (customerView) {
    header.append(node('h2',record.name));
    const actions = node('div',undefined,'actions');
    actions.append(button('이 고객의 주문',() => showRelatedOrders('customer',record.id)));
    actions.append(button('고객 정보 수정',() => openCustomer(record)));
    actions.append(button('송장용 고객 정보 복사',() => copyShippingDetails(record)));
    const add = button('추출 기록 연결',() => openLink(record),'primary');
    add.disabled = records.extracts.length === 0;
    actions.append(add);
    header.append(actions);
    const data = node('dl',undefined,'contact');
    for (const [label,value] of [['연락처',record.phone],['주소',record.address]]) {
      const item = node('div');
      item.append(node('dt',label),node('dd',value || '미입력'));
      data.append(item);
    }
    detail.append(data);
  } else {
    detail.append(node('p',record.source ? record.source + ' · ' + record.created_at.slice(0,10) : record.created_at.slice(0,10),'muted'));
    const filename = record.data.__shot_filename;
    const localGraph = typeof filename === 'string' && /^\d{4}-\d{2}-\d{2}_\d+\.png$/.test(filename);
    header.append(extractTitleEditor(record, localGraph ? filename : null),
      button('관련 주문 보기',() => showRelatedOrders('extract',record.id)));
    if (localGraph || record.data.__erp_png) {
      const image = node('img',undefined,'extract-image');
      image.src = localGraph ? '/api/extractions/files/' + filename : pngUrl(record.data.__erp_png);
      image.alt = record.title + ' 추출 그래프';
      const download = node('a','원본 PNG 내려받기');
      download.href = image.src;
      download.download = /\.png$/i.test(record.source) ? record.source : '추출-그래프.png';
      detail.append(image,download);
      if (localGraph) image.addEventListener('error', () => {
        image.replaceWith(node('p', '원본 그래프를 찾지 못했습니다. data 폴더에 PNG 파일이 있는지 확인하세요.', 'muted'));
      });
    }
    const table = node('table');
    table.setAttribute('aria-label','추출 데이터 항목');
    for (const [key,value] of extractFields(record.data)) {
      const row = table.insertRow();
      const label = node('th',key);
      label.scope = 'row';
      row.append(label,node('td',typeof value === 'object' ? JSON.stringify(value,null,2) : String(value)));
    }
    detail.append(table);
  }
  const links = node('div',undefined,'divider');
  links.append(node('h3',customerView ? '연결된 추출 기록' : '연결된 고객'));
  const items = records.customer_extracts.filter(link => customerView ? link.customer_id === record.id : link.extract_id === record.id);
  if (!items.length) links.append(node('p',customerView && !records.extracts.length ?
    '상단에서 추출 데이터를 추가하면 이 고객에게 연결할 수 있습니다.' : '아직 연결 내역이 없습니다.','empty'));
  for (const item of items) {
    const linked = customerView ? records.extracts.find(e => e.id === item.extract_id) :
      records.customers.find(c => c.id === item.customer_id);
    if (!linked) continue;
    const row = node('div',undefined,'link-row');
    const info = node('div');
    info.append(button(customerView ? linked.title : linked.name,() => showTab(customerView ? 'extracts' : 'customers',linked.id),'text-button'));
    info.append(node('p',item.linked_on + (item.quantity === null ? '' : ' · ' + item.quantity.toLocaleString('ko-KR') + '개'),'muted'));
    if (item.note) info.append(node('p',item.note));
    const actions = node('div',undefined,'actions');
    actions.append(button('연결 해제',() => unlink(item.id)));
    row.append(info,actions);
    links.append(row);
  }
  detail.append(links);
}

function extractTitleEditor(record, filename) {
  const editor = node('div',undefined,'record-title-editor');
  const heading = node('h2');
  const form = node('form',undefined,'actions');
  const input = node('input');
  input.type = 'text';
  input.setAttribute('aria-label','기록 제목');
  input.maxLength = filename ? 120 : 240;
  input.required = !filename;
  const title = button(record.title,() => {
    input.value = record.title;
    heading.hidden = true;
    form.hidden = false;
    input.focus();
    input.select();
  },'editable-title');
  title.title = '클릭하여 제목 수정';
  heading.append(title);
  const save = node('button','제목 저장');
  save.type = 'submit';
  function cancel() {
    form.hidden = true;
    heading.hidden = false;
    title.focus();
  }
  form.append(input,save,button('취소',cancel));
  form.hidden = true;
  form.addEventListener('keydown',event => {
    if (event.key === 'Escape') cancel();
  });
  editor.append(heading,form);
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      if (filename) {
        const response = await fetch('/api/extractions/title/' + encodeURIComponent(filename), {
          method:'POST', headers:{'Content-Type':'application/json','X-Shot-Save':'1'},
          body:JSON.stringify(input.value),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
      } else {
        await api('rename-extract',{id:record.id,title:input.value});
      }
      await refresh();
      notice('제목을 저장했습니다.');
    } catch (error) {
      notice(error.message,true);
    } finally {
      save.disabled = false;
    }
  });
  return editor;
}

async function unlink(id) {
  if (busy || !confirm('이 연결을 해제할까요? 고객과 추출 기록은 보존됩니다.')) return;
  busy = true;
  try {
    await api('unlink',{id});
    await refresh();
    notice('연결을 해제했습니다.');
  } catch (error) { notice(error.message,true); }
  finally { busy = false; }
}

function openCustomer(record) {
  customerId = record?.id ?? null;
  customerForm.reset();
  formError(customerForm,'');
  byId('customer-title').textContent = record ? '고객 정보 수정' : '고객 등록';
  for (const key of ['name','phone','address']) customerForm.elements.namedItem(key).value = record?.[key] ?? '';
  byId('customer-dialog').showModal();
}

function openLink(customer) {
  linkCustomerId = customer.id;
  linkForm.reset();
  formError(linkForm,'');
  byId('link-customer').textContent = customer.name + ' 고객';
  const select = linkForm.elements.namedItem('extract_id');
  select.replaceChildren(new Option('추출 기록 선택',''));
  for (const item of records.extracts) {
    select.add(new Option(item.title + ' · ' + item.created_at.slice(0,10),item.id));
  }
  linkForm.elements.namedItem('linked_on').value = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  byId('link-dialog').showModal();
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', state = 'start';
  const endField = () => { row.push(field); field = ''; state = 'start'; };
  const endRow = () => { endField(); if (row.some(value => value !== '')) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (state === 'quoted') {
      if (char === '"' && text[index+1] === '"') { field += '"'; index++; }
      else if (char === '"') state = 'closed';
      else field += char;
      continue;
    }
    if (char === ',' || char === '\r' || char === '\n') {
      if (char === ',') endField();
      else {
        endRow();
        if (char === '\r' && text[index+1] === '\n') index++;
      }
    } else if (char === '"' && state === 'start') state = 'quoted';
    else if (char === '"' || state === 'closed') throw new Error('CSV의 따옴표를 확인하세요.');
    else { state = 'plain'; field += char; }
  }
  if (state === 'quoted') throw new Error('CSV의 닫는 따옴표가 빠져 있습니다.');
  endRow();
  const fields = rows.shift()?.map(field => field.trim());
  if (!fields?.length || fields.some(field => !field) || new Set(fields).size !== fields.length) {
    throw new Error('CSV 첫 행에는 중복되거나 빈 항목 이름이 없어야 합니다.');
  }
  return rows.map((values,index) => {
    if (values.length !== fields.length) throw new Error('CSV의 ' + (index + 2) + '번째 기록에서 열 개수가 맞지 않습니다.');
    return Object.fromEntries(fields.map((field,i) => [field,values[i]]));
  });
}

function decodeInput(text, filename) {
  const cleaned = text.replace(/^\uFEFF/,'');
  if (!cleaned.trim()) throw new Error('파일을 선택하거나 내용을 입력하세요.');
  if (/\.json$/i.test(filename) || (!/\.csv$/i.test(filename) && /^[{[]/.test(cleaned.trimStart()))) {
    let value;
    try { value = JSON.parse(cleaned); }
    catch { throw new Error('JSON 문법을 확인하세요.'); }
    return Array.isArray(value) ? value : [value];
  }
  return parseCsv(cleaned);
}

function invalidatePreview() {
  previewRecords = [];
  byId('save-extract').disabled = true;
  byId('import-preview').hidden = true;
  byId('preview-image').hidden = true;
  byId('preview-image').removeAttribute('src');
}

function preview() {
  formError(extractForm,'');
  invalidatePreview();
  try {
    const fields = new FormData(extractForm);
    const text = String(fields.get('text'));
    if (new TextEncoder().encode(text).length > 7_000_000) throw new Error('입력 파일을 7MB 이하로 나눠 주세요.');
    const stamp = /^(\d{4}-\d{2}-\d{2})_(\d+)\.png$/i.exec(source);
    const data = selectedPng ? [{
      '원본 파일명':source, ...(stamp ? {'추출일':stamp[1],'순번':stamp[2]} : {})
    }] : decodeInput(text,source);
    const name = String(fields.get('title')).trim() || source.replace(/\.[^.]+$/,'').slice(0,200) || '추출 기록';
    if (!data.length || data.some(item => !item || typeof item !== 'object' || Array.isArray(item) || !Object.keys(item).length)) {
      throw new Error('항목 이름과 값이 들어 있는 기록을 한 건 이상 입력하세요.');
    }
    const encoder = new TextEncoder();
    if (data.some(item => encoder.encode(JSON.stringify(item)).length > 40000)) throw new Error('추출 기록 한 건은 40KB까지 저장할 수 있습니다.');
    previewRecords = data.map((item,index) => ({
      title:data.length === 1 ? name : name + ' · ' + (index + 1), source,
      data:selectedPng ? {...item,__erp_png:selectedPng} : item
    }));
    byId('preview-title').textContent = data.length.toLocaleString('ko-KR') + '건 · 첫 번째 기록 미리보기';
    byId('preview-data').textContent = JSON.stringify(data[0],null,2);
    if (selectedPng) {
      byId('preview-image').src = pngUrl(selectedPng);
      byId('preview-image').hidden = false;
    }
    byId('import-preview').hidden = false;
    byId('save-extract').disabled = false;
  } catch (error) { formError(extractForm,error.message); }
}

function bindSubmit(form, action) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    formError(form,'');
    try {
      const after = await action(Object.fromEntries(new FormData(form)));
      form.closest('dialog').close();
      try { await refresh(); }
      catch { notice('저장은 완료됐지만 화면을 갱신하지 못했습니다. 새로고침해 주세요.',true); return; }
      after();
    } catch (error) { formError(form,error.message); }
    finally { busy = false; submit.disabled = form === extractForm && !previewRecords.length; }
  });
}

bindSubmit(customerForm,async fields => {
  const result = await api('customers',{...fields,id:customerId});
  return () => { showTab('customers',result.id); notice('고객 정보를 저장했습니다.'); };
});
bindSubmit(extractForm,async () => {
  if (!previewRecords.length) throw new Error('먼저 추출 기록을 미리보세요.');
  const result = await api('extracts',{records:previewRecords});
  return () => { showTab('extracts'); notice(result.count + '건의 추출 기록을 저장했습니다.'); };
});
bindSubmit(linkForm,async fields => {
  const extract_id = await registerExtract(fields.extract_id);
  await api('links',{...fields,extract_id,customer_id:linkCustomerId,quantity:fields.quantity ? Number(fields.quantity) : null});
  return () => notice('고객과 추출 기록을 연결했습니다.');
});

async function downloadBackup() {
  byId('data-menu').open = false;
  const control = byId('backup');
  control.disabled = true;
  try {
    const snapshot = await api('backup');
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)],{type:'application/json'}));
    const a = node('a');
    a.href = url;
    a.download = '주문-ERP-백업-' + new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()) + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    notice('전체 백업 파일을 내려받았습니다.');
  } catch (error) { notice(error.message,true); }
  finally { control.disabled = false; }
}

window.erpData = {
  getRecords: () => records, api, notice, refresh, registerExtract,
  openCustomer: id => showTab('customers',id),
  openExtract: id => showTab('extracts',id)
};

byId('order-tab').addEventListener('click',() => {
  Promise.resolve(showTab('orders')).catch(error => notice(error.message,true));
});
byId('customer-tab').addEventListener('click',() => showTab('customers'));
byId('extract-tab').addEventListener('click',async () => {
  showTab('extracts');
  try { await refresh(); }
  catch (error) { notice(error.message,true); }
});
byId('return-to-graph').addEventListener('click',event => {
  if (window.parent === window) return;
  event.preventDefault();
  window.parent.postMessage({type:'shot:show-graph'},location.origin);
});

window.addEventListener('message',async event => {
  if (window.parent === window || event.origin !== location.origin || event.source !== window.parent
      || event.data?.type !== 'shot:show-orders') return;
  try {
    await refresh();
    if (event.data.filename) {
      const record = records.extracts.find(item => item.data.__shot_filename === event.data.filename);
      if (!record) throw new Error('추출 히스토리에서 기록을 찾지 못했습니다.');
      showTab('extracts', record.id);
    } else if (tab === 'orders') await window.erpUi.activate();
  } catch (error) { notice(error.message,true); }
});
byId('add-customer').addEventListener('click',() => openCustomer());
search.addEventListener('input',render);
byId('import-extract').addEventListener('click',() => {
  extractForm.reset();
  fileVersion++;
  source = '';
  selectedPng = '';
  byId('extract-text').disabled = false;
  invalidatePreview();
  formError(extractForm,'');
  byId('extract-dialog').showModal();
});
extractForm.addEventListener('input',invalidatePreview);
byId('preview').addEventListener('click',preview);
byId('extract-file').addEventListener('change',async event => {
  const file = event.target.files[0], version = ++fileVersion;
  if (!file) return;
  byId('extract-text').value = '';
  byId('extract-text').disabled = false;
  source = '';
  selectedPng = '';
  invalidatePreview();
  formError(extractForm,'');
  try {
    if (/\.png$/i.test(file.name) || file.type === 'image/png') {
      if (file.size > 786432) throw new Error('PNG 파일은 768KiB까지 추가할 수 있습니다.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((byte,index) => bytes[index] === byte)) {
        throw new Error('올바른 PNG 파일을 선택하세요.');
      }
      const encoded = bytes.toBase64 ? bytes.toBase64() : btoa(bytes.reduce((text,byte) => text + String.fromCharCode(byte),''));
      const image = new Image();
      image.src = pngUrl(encoded);
      try { await image.decode(); } catch { throw new Error('PNG 이미지를 열 수 없습니다. 파일을 확인하세요.'); }
      if (version !== fileVersion) return;
      selectedPng = encoded;
      source = file.name;
      byId('extract-text').disabled = true;
      preview();
      return;
    }
    if (file.size > 7_000_000) throw new Error('입력 파일을 7MB 이하로 나눠 주세요.');
    const text = await file.text();
    if (version !== fileVersion) return;
    if (text.includes('\uFFFD')) throw new Error('파일을 UTF-8로 저장한 뒤 다시 선택하세요.');
    source = file.name;
    byId('extract-text').value = text;
    preview();
  } catch (error) { if (version === fileVersion) formError(extractForm,error.message); }
});
for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click',() => el.closest('dialog').close());
byId('backup').addEventListener('click',downloadBackup);
byId('restore').addEventListener('click',() => {
  byId('data-menu').open = false;
  byId('backup-file').click();
});
byId('backup-file').addEventListener('change',async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || busy) return;
  busy = true;
  try {
    if (file.size > 12_000_000) throw new Error('이 백업 파일은 한 번에 불러오기에는 너무 큽니다.');
    let saved;
    try { saved = JSON.parse(await file.text()); }
    catch { throw new Error('백업 파일의 JSON 형식을 확인하세요.'); }
    const result = await api('restore',saved);
    await refresh();
    if (tab === 'orders') await window.erpUi.activate();
    notice(result.count ? result.count + '개의 기록을 불러왔습니다.' : '추가할 기록이 없습니다. 기존 기록은 유지됩니다.');
  } catch (error) { notice(error.message,true); }
  finally { busy = false; }
});
window.addEventListener('DOMContentLoaded',async () => {
  render();
  try {
    const url = new URL(location.href);
    const filename = url.searchParams.get('shot');
    if (filename) {
      const result = await api('shot-extract', { filename });
      url.searchParams.delete('shot');
      url.searchParams.set('extract', result.id);
      history.replaceState(null, '', url);
    }
    await refresh();
    const extract = url.searchParams.get('extract');
    if (extract && records.extracts.some(record => record.id === extract)) {
      showTab('extracts', extract);
      notice('이 추출 기록은 주문의 출고 내역에서 선택할 수 있습니다.');
    } else if (tab === 'orders') await window.erpUi.activate();
  } catch (error) { notice(error.message,true); }
});
