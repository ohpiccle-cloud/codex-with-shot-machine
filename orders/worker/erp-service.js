(() => {
  'use strict';

  const number = new Intl.NumberFormat('ko-KR');
  const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'});
  const serviceStatuses = ['접수','진행 중','완료','취소'];
  const serviceStyles = {'접수':'open','진행 중':'in_progress','완료':'resolved','취소':'cancelled'};
  let pending = false;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(text, onClick, className) {
    const node = element('button',text,className);
    node.type = 'button';
    node.addEventListener('click',onClick);
    return node;
  }

  function openSection(parent, name, action, onClick, actionId) {
    const section = element('section',undefined,'erp-service-section');
    const heading = element('div',undefined,'erp-service-heading');
    const title = element('h3',name);
    title.id = actionId + '-heading';
    section.setAttribute('aria-labelledby',title.id);
    const trigger = button(action,onClick);
    trigger.id = actionId;
    heading.append(title,trigger);
    section.append(heading);
    parent.append(section);
    return {section, trigger};
  }

  function adjacentEntries(parent, records, emptyText, renderEntry) {
    if (!records.length) {
      parent.append(element('p',emptyText,'erp-service-empty'));
      return;
    }
    const list = element('ul',undefined,'erp-service-list');
    for (const record of records) {
      const entry = element('li',undefined,'erp-service-entry');
      const contents = element('div',undefined,'erp-service-entry-body');
      entry.append(contents);
      renderEntry(entry,contents,record);
      list.append(entry);
    }
    parent.append(list);
  }

  function description(parent, content) {
    if (content) parent.append(element('p',content,'erp-service-entry-note'));
  }

  function actionsFor(entry, label, edit, remove) {
    const actions = element('div',undefined,'actions erp-service-actions');
    const editButton = button('수정',edit);
    const removeButton = button('삭제',remove);
    editButton.setAttribute('aria-label',label + ' 수정');
    removeButton.setAttribute('aria-label',label + ' 삭제');
    actions.append(editButton,removeButton);
    entry.append(actions);
  }

  function itemLabel(item) {
    return item?.name ? item.name + (item.sku ? ' · ' + item.sku : '') : '상품';
  }

  function titleRow(parent, title) {
    const row = element('div',undefined,'erp-service-entry-title');
    row.append(element('h4',title));
    parent.append(row);
    return row;
  }

  function itemRemaining(context, item, editing) {
    const shipped = context.shipments.reduce((total,record) => (
      record.order_item_id === item.id && record.id !== editing?.id ? total + record.quantity : total
    ), 0);
    return Math.max(0,item.quantity - shipped);
  }

  function openDialog({title, controlId, fields, onSubmit, onInit, reload, success}) {
    if (pending) return;
    const dialog = element('dialog',undefined,'erp-service-dialog');
    const heading = element('h2',title);
    heading.id = 'erp-service-dialog-title';
    dialog.setAttribute('aria-labelledby',heading.id);
    const form = element('form');
    const group = element('div',undefined,'erp-service-fields');
    const controls = {};
    for (const field of fields) {
      const label = element('label',undefined,field.full ? 'erp-service-full' : undefined);
      const labelText = element('span',field.label);
      labelText.id = 'erp-service-label-' + field.name;
      const control = element(field.type === 'select' || field.type === 'textarea' ? field.type : 'input');
      if (control.tagName === 'SELECT') {
        for (const [value,text] of field.options) control.add(new Option(text,value));
      } else if (control.tagName === 'TEXTAREA') {
        control.rows = field.rows ?? 3;
      } else {
        control.type = field.type;
      }
      if (field.maxLength !== undefined) control.maxLength = field.maxLength;
      for (const key of ['min','max','step','required']) {
        if (field[key] !== undefined) control[key] = field[key];
      }
      control.name = field.name;
      control.setAttribute('aria-labelledby',labelText.id);
      control.value = field.value ?? '';
      label.append(labelText,control);
      if (field.help) {
        const help = element('small',field.help,'erp-service-help');
        help.id = 'erp-service-help-' + field.name;
        control.setAttribute('aria-describedby',help.id);
        label.append(help);
      }
      controls[field.name] = control;
      group.append(label);
    }
    const error = element('p',undefined,'form-error');
    error.setAttribute('role','alert');
    error.hidden = true;
    const actions = element('div',undefined,'actions');
    const cancel = button('닫기',() => dialog.close());
    const submit = element('button','저장','primary');
    submit.type = 'submit';
    actions.append(cancel,submit);
    form.append(heading,group,error,actions);
    dialog.append(form);
    dialog.addEventListener('close',() => dialog.remove(),{once:true});
    dialog.addEventListener('cancel',event => {
      if (pending) event.preventDefault();
    });
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if (pending) return;
      pending = true;
      submit.disabled = true;
      cancel.disabled = true;
      error.hidden = true;
      try {
        await onSubmit(Object.fromEntries(new FormData(form)));
      } catch (problem) {
        error.textContent = problem.message;
        error.hidden = false;
        pending = false;
        submit.disabled = false;
        cancel.disabled = false;
        return;
      }
      dialog.close();
      try {
        await reload();
        window.erpData.notice(success);
        document.getElementById(controlId)?.focus();
      } catch {
        window.erpData.notice('저장은 완료됐습니다. 새로고침하여 최신 내역을 확인하세요.',true);
      } finally {
        pending = false;
      }
    });
    controls[fields[0].name].autofocus = true;
    onInit?.(controls);
    document.body.append(dialog);
    dialog.showModal();
  }

  const memoField = value => ({name:'note',label:'메모',type:'textarea',maxLength:1000,full:true,value});
  const dateField = (name, label, value) => ({name,label,type:'date',required:true,value:value ?? date.format(new Date())});
  const orderItemOptions = items => items.map(item => [item.id,itemLabel(item)]);

  async function remove(context, kind, record, label, controlId) {
    if (pending || !window.confirm(label + ' 기록을 삭제할까요?')) return;
    pending = true;
    try {
      await window.erpData.api('erp/remove',{kind,id:record.id});
      try {
        await context.reload();
        window.erpData.notice(label + ' 기록을 삭제했습니다.');
        document.getElementById(controlId)?.focus();
      } catch {
        window.erpData.notice('삭제는 완료됐습니다. 새로고침하여 최신 내역을 확인하세요.',true);
      }
    } catch (error) {
      window.erpData.notice(error.message,true);
    } finally {
      pending = false;
    }
  }

  let loadingShipment = false;
  async function shipmentDialog(context, shipment) {
    const availableItems = context.items.filter(item => itemRemaining(context,item,shipment) > 0);
    if (!availableItems.length || loadingShipment || pending) return;
    loadingShipment = true;
    try {
      await window.erpData.refresh();
    } catch (error) {
      window.erpData.notice(error.message,true);
      return;
    } finally {
      loadingShipment = false;
    }
    const extracts = window.erpData.getRecords().extracts;
    const itemId = shipment?.order_item_id ?? availableItems[0].id;
    const options = availableItems.map(item => [item.id,itemLabel(item) + ' · 출고 가능 ' +
      number.format(itemRemaining(context,item,shipment)) + '개']);
    const fields = [
      {name:'order_item_id',label:'주문 상품',type:'select',options,required:true,value:itemId,full:true},
      {name:'extract_id',label:'추출 기록',type:'select',full:true,value:shipment?.extract_id,
        options:[['','연결 없이 기록'],...extracts.map(extract => [extract.id,extract.title])],
        help:'실제로 출고한 상품에 해당하는 추출 기록을 선택하세요.'},
      {name:'quantity',label:'출고 수량',type:'number',required:true,min:1,step:1,value:shipment?.quantity},
      dateField('shipped_on','출고 날짜',shipment?.shipped_on),
      memoField(shipment?.note)
    ];
    openDialog({
      title:shipment ? '출고 기록 수정' : '출고 기록 추가',
      controlId:'erp-add-shipment',
      fields,
      onInit(controls) {
        const update = () => {
          const item = availableItems.find(row => row.id === controls.order_item_id.value);
          controls.quantity.max = Math.min(1000000,itemRemaining(context,item,shipment));
        };
        controls.order_item_id.addEventListener('change',update);
        update();
      },
      onSubmit:async values => {
        const extract_id = await window.erpData.registerExtract(values.extract_id);
        return window.erpData.api('erp/shipments',{
          ...values,id:shipment?.id,extract_id,quantity:Number(values.quantity)
        });
      },
      reload:context.reload,
      success:'출고 기록을 저장했습니다.'
    });
  }

  function renderShipments(parent, context) {
    const {section,trigger} = openSection(parent,'출고 및 추출 기록','출고 추가',
      () => shipmentDialog(context),'erp-add-shipment');
    trigger.disabled = !context.items.some(item => itemRemaining(context,item) > 0);
    if (trigger.disabled && context.items.length) section.append(element('p','모든 주문 상품의 출고를 기록했습니다.','erp-service-empty'));
    adjacentEntries(section,context.shipments,'기록된 출고가 없습니다.',(entry,contents,record) => {
      const item = context.items.find(row => row.id === record.order_item_id);
      titleRow(contents,itemLabel(item) + ' · ' + number.format(record.quantity) + '개');
      contents.append(element('p',record.shipped_on,'erp-service-entry-meta'));
      const extract = context.extracts.find(row => row.id === record.extract_id);
      if (extract) {
        const ref = element('p',undefined,'erp-service-entry-note');
        ref.append(element('strong','추출 기록'),button(extract.title,() => window.erpData.openExtract(extract.id),'text-button'));
        contents.append(ref);
      } else {
        description(contents,'출고에 연결된 추출 기록 없음');
      }
      description(contents,record.note);
      actionsFor(entry,'출고 기록',() => shipmentDialog(context,record),
        () => remove(context,'shipments',record,'출고','erp-add-shipment'));
    });
  }

  function feedbackDialog(context, feedback) {
    const fields = [
      {name:'score',label:'만족도 점수',type:'select',required:true,
        options:[['','점수 선택'],...['1','2','3','4','5'].map(score => [score,score + '점'])],value:feedback?.score},
      dateField('recorded_on','기록 날짜',feedback?.recorded_on),
      {...memoField(feedback?.note),label:'고객 의견'}
    ];
    openDialog({
      title:feedback ? '만족도 수정' : '만족도 추가',
      controlId:'erp-add-feedback',
      fields,
      onSubmit:values => window.erpData.api('erp/feedback',{
        ...values,id:feedback?.id,order_id:context.order.id,score:Number(values.score)
      }),
      reload:context.reload,
      success:'만족도 기록을 저장했습니다.'
    });
  }

  function renderFeedback(parent, context) {
    const {section} = openSection(parent,'만족도','만족도 추가',
      () => feedbackDialog(context),'erp-add-feedback');
    adjacentEntries(section,context.feedback,'기록된 만족도가 없습니다.',(entry,contents,record) => {
      titleRow(contents,record.score + '점 / 5점');
      contents.append(element('p',record.recorded_on,'erp-service-entry-meta'));
      description(contents,record.note);
      actionsFor(entry,'만족도 ' + record.recorded_on,() => feedbackDialog(context,record),
        () => remove(context,'feedback',record,'만족도','erp-add-feedback'));
    });
  }

  function serviceDialog(context, service) {
    const fields = [
      {name:'subject',label:'문의·A/S 제목',type:'text',required:true,maxLength:160,full:true,value:service?.subject},
      {name:'order_item_id',label:'관련 주문 상품',type:'select',full:true,value:service?.order_item_id,
        options:[['','주문 전체'],...orderItemOptions(context.items)]},
      {name:'status',label:'처리 상태',type:'select',required:true,
        options:serviceStatuses.map(status => [status,status]),value:service?.status ?? '접수'},
      dateField('opened_on','접수 날짜',service?.opened_on),
      {...memoField(service?.note),label:'문의 내용 및 처리 메모',rows:4}
    ];
    openDialog({
      title:service ? 'A/S 기록 수정' : 'A/S 기록 추가',
      controlId:'erp-add-service',
      fields,
      onSubmit:values => window.erpData.api('erp/services',{
        ...values,id:service?.id,order_id:context.order.id,order_item_id:values.order_item_id || null
      }),
      reload:context.reload,
      success:'A/S 기록을 저장했습니다.'
    });
  }

  function renderServices(parent, context) {
    const {section} = openSection(parent,'A/S','A/S 추가',() => serviceDialog(context),'erp-add-service');
    adjacentEntries(section,context.services,'접수된 A/S가 없습니다.',(entry,contents,record) => {
      const heading = titleRow(contents,record.subject);
      const status = element('span',record.status,'erp-service-tag');
      status.dataset.state = serviceStyles[record.status] ?? '';
      heading.append(status);
      const item = context.items.find(row => row.id === record.order_item_id);
      contents.append(element('p',record.opened_on + ' · ' + (item ? itemLabel(item) : '주문 전체'),'erp-service-entry-meta'));
      description(contents,record.note);
      actionsFor(entry,'A/S ' + record.subject,() => serviceDialog(context,record),
        () => remove(context,'services',record,'A/S','erp-add-service'));
    });
  }

  window.erpService = {
    render(container,context) {
      const root = element('div',undefined,'erp-service');
      renderShipments(root,context);
      renderFeedback(root,context);
      renderServices(root,context);
      container.append(root);
    }
  };
})();
