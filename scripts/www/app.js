/* ==========================================================================
   每日打卡 - 全部逻辑（纯静态重写版）
   关键原则：
   - 每个 DOM 访问前做 null 检查，避免任一步 throw 导致全页崩溃；
   - window.onerror 捕获全局错误写入 console.error，便于浏览器控制台排查；
   - refreshAll 每步独立 try/catch，单个函数异常不阻断其余渲染；
   - 日历严格使用 <table><colgroup><col width=14.28%> 实现 7 列等分，
     完全不依赖 CSS Grid / flex-wrap / aspect-ratio，100% 不塌陷。
   ========================================================================== */

(function () {
  "use strict";

  // ===== 全局常量 & 工具 =====
  var RECORDS_KEY = "checkin_records_v1";
  var SETTINGS_KEY = "checkin_settings_v1";
  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

  var viewDate = new Date();
  viewDate.setDate(1);

  var currentTab = "list";
  var editingDate = null;
  var editingType = "checkin";
  var modalCallback = null;

  function safeSetText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(text == null ? "" : text);
  }

  function safeEl(id) {
    return document.getElementById(id);
  }

  // 全局错误捕获（仅输出到控制台，不显示在页面上）
  window.onerror = function (msg, url, line, col, err) {
    try {
      console.error("[错误]", msg, url, line, col, err);
    } catch (e) {}
    return false;
  };

  window.addEventListener("unhandledrejection", function (ev) {
    try {
      console.error("[Promise 拒绝]", ev && ev.reason);
    } catch (e) {}
  });

  // ---------- 日期工具 ----------
  function pad2(n) {
    n = Number(n) || 0;
    return n < 10 ? "0" + n : String(n);
  }
  function fmtDate(d) {
    return (
      d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
    );
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }
  function timeStrFromTs(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function todayStr() {
    return fmtDate(new Date());
  }

  // ---------- 存储 ----------
  function loadRecords() {
    try {
      var s = localStorage.getItem(RECORDS_KEY);
      if (!s) return {};
      var obj = JSON.parse(s);
      if (obj && typeof obj === "object") return obj;
      return {};
    } catch (e) {
      try { console.error("loadRecords 异常:", e); } catch (_) {}
      return {};
    }
  }
  function saveRecords(obj) {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(obj || {}));
    } catch (e) {
      try { console.error("saveRecords 异常:", e); } catch (_) {}
      showToast("保存失败：" + String(e.message || e));
    }
  }
  function loadSettings() {
    try {
      var s = localStorage.getItem(SETTINGS_KEY);
      if (!s) return {};
      var obj = JSON.parse(s);
      if (obj && typeof obj === "object") return obj;
      return {};
    } catch (e) {
      try { console.error("loadSettings 异常:", e); } catch (_) {}
      return {};
    }
  }
  function saveSettings(obj) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj || {}));
    } catch (e) {
      try { console.error("saveSettings 异常:", e); } catch (_) {}
    }
  }

  // ---------- Toast & Modal ----------
  function showToast(msg) {
    var t = safeEl("toast");
    if (!t) return;
    t.textContent = String(msg || "");
    t.classList.add("show");
    setTimeout(function () {
      t.classList.remove("show");
    }, 1600);
  }
  function showModal(title, text, cb) {
    safeSetText("modalTitle", title);
    safeSetText("modalText", text);
    var mask = safeEl("modalMask");
    if (mask) mask.classList.add("show");
    modalCallback = cb || null;
  }
  function hideModal() {
    var mask = safeEl("modalMask");
    if (mask) mask.classList.remove("show");
    modalCallback = null;
  }

  // ---------- 渲染：头部 ----------
  function renderHeader() {
    var now = new Date();
    var txt =
      now.getFullYear() +
      "年" +
      (now.getMonth() + 1) +
      "月" +
      now.getDate() +
      "日 星期" +
      WEEKDAYS[now.getDay()];
    safeSetText("todayDate", txt);
  }

  // ---------- 渲染：状态卡片 ----------
  function renderStatus() {
    var records = loadRecords();
    var today = todayStr();
    var rec = records[today];

    var statusEl = safeEl("statusValue");
    var btn = safeEl("checkinBtn");
    var timeEl = safeEl("checkinTime");

    if (rec) {
      if (statusEl) {
        if (rec.type === "absent") {
          statusEl.textContent = "今日缺勤 ✗";
          statusEl.classList.add("absent");
          statusEl.classList.remove("checked");
        } else {
          statusEl.textContent = "已打卡 ✓";
          statusEl.classList.add("checked");
          statusEl.classList.remove("absent");
        }
      }
      if (btn) {
        btn.textContent = rec.type === "absent" ? "已标记缺勤" : "今日已打卡";
        btn.disabled = true;
      }
      if (timeEl) {
        var tag =
          rec.type === "supplement" ? "补签" :
          rec.type === "absent" ? "缺勤" : "打卡";
        timeEl.textContent = tag + "时间：" + fmtTime(rec.timestamp);
      }
    } else {
      if (statusEl) {
        statusEl.textContent = "未打卡";
        statusEl.classList.remove("checked");
      }
      if (btn) {
        btn.textContent = "立即打卡";
        btn.disabled = false;
      }
      if (timeEl) timeEl.textContent = "";
    }
  }

  // ---------- 渲染：统计 ----------
  function renderStats() {
    var records = loadRecords();
    var now = new Date();
    var ym = now.getFullYear() + "-" + pad2(now.getMonth() + 1);

    var monthCount = 0;
    var keys = Object.keys(records);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(ym) === 0) monthCount++;
    }

    var streak = 0;
    var cur = new Date();
    while (true) {
      var k = fmtDate(cur);
      if (records[k]) {
        streak++;
        cur.setDate(cur.getDate() - 1);
      } else {
        break;
      }
    }

    safeSetText("monthCount", String(monthCount));
    safeSetText("streak", String(streak));
    safeSetText("totalCount", String(keys.length));
  }

  // ---------- 渲染：薪资 ----------
  function renderSalary() {
    var settings = loadSettings();
    var input = safeEl("dailySalary");
    var daily = 0;
    if (input) {
      if (!input.value && settings.dailySalary) {
        input.value = settings.dailySalary;
      }
      daily = parseFloat(input.value) || 0;
    } else if (settings.dailySalary) {
      daily = parseFloat(settings.dailySalary) || 0;
    }

    var records = loadRecords();
    var now = new Date();
    var ym = now.getFullYear() + "-" + pad2(now.getMonth() + 1);

    var checkinCount = 0;
    var supplementCount = 0;
    var absentCount = 0;
    var keys = Object.keys(records);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf(ym) !== 0) continue;
      var rec = records[k];
      if (!rec) continue;
      if (rec.type === "supplement") supplementCount++;
      else if (rec.type === "absent") absentCount++;
      else checkinCount++;
    }
    var totalDays = checkinCount + supplementCount;
    var monthSalary = totalDays * daily;

    var box = safeEl("salaryResult");
    if (!box) return;

    box.innerHTML =
      '<div class="row"><span>本月正常打卡</span><span>' +
      checkinCount +
      ' 天</span></div>' +
      '<div class="row"><span>本月补签</span><span>' +
      supplementCount +
      ' 天</span></div>' +
      '<div class="row"><span>本月缺勤</span><span style="color:#ef4444">' +
      absentCount +
      ' 天（不计薪）</span></div>' +
      '<div class="row"><span>日薪</span><span>' +
      daily.toFixed(2) +
      ' 元/天</span></div>' +
      '<div class="row total"><span>本月应发月薪</span><span>' +
      monthSalary.toFixed(2) +
      ' 元</span></div>' +
      '<div class="salary-formula">' +
      "月薪计算公式：<br>" +
      "月薪 = (打卡天数 + 补签天数) × 日薪 &nbsp;（缺勤不计入）<br>" +
      "&nbsp;&nbsp;&nbsp;&nbsp; = (" +
      checkinCount +
      " + " +
      supplementCount +
      ") × " +
      daily.toFixed(2) +
      "<br>" +
      "&nbsp;&nbsp;&nbsp;&nbsp; = " +
      totalDays +
      " × " +
      daily.toFixed(2) +
      "<br>" +
      "&nbsp;&nbsp;&nbsp;&nbsp; = <b>" +
      monthSalary.toFixed(2) +
      " 元</b>" +
      "</div>";
  }

  // ---------- 渲染：日历（重点：纯 table 实现） ----------
  function renderCalendar() {
    var y = viewDate.getFullYear();
    var m = viewDate.getMonth();

    safeSetText("monthLabel", y + "年" + (m + 1) + "月");

    var wrap = safeEl("calendarWrap");
    if (!wrap) {
      return;
    }

    var records = loadRecords();
    var firstDay = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var today = todayStr();

    // 构建 table
    var table = document.createElement("table");
    table.className = "cal-table";

    // colgroup：固定每列宽度，table-layout: fixed 保证等分
    var colgroup = document.createElement("colgroup");
    for (var ci = 0; ci < 7; ci++) {
      var col = document.createElement("col");
      col.className = "cal-col";
      colgroup.appendChild(col);
    }
    table.appendChild(colgroup);

    // thead
    var thead = document.createElement("thead");
    var headTr = document.createElement("tr");
    for (var hi = 0; hi < 7; hi++) {
      var th = document.createElement("th");
      th.className = "cal-head";
      th.textContent = WEEKDAYS[hi];
      headTr.appendChild(th);
    }
    thead.appendChild(headTr);
    table.appendChild(thead);

    // tbody
    var tbody = document.createElement("tbody");
    var cellIdx = 0;
    var totalCells = firstDay + daysInMonth;
    var totalRows = Math.ceil(totalCells / 7);
    var todayCutoff = new Date();
    todayCutoff.setHours(23, 59, 59, 999);

    for (var r = 0; r < totalRows; r++) {
      var tr = document.createElement("tr");
      for (var c = 0; c < 7; c++) {
        var td = document.createElement("td");
        td.className = "cal-cell";

        if (cellIdx < firstDay) {
          td.classList.add("empty");
        } else if (cellIdx >= firstDay + daysInMonth) {
          td.classList.add("empty");
        } else {
          var d = cellIdx - firstDay + 1;
          var dateStr = y + "-" + pad2(m + 1) + "-" + pad2(d);
          td.textContent = String(d);
          td.setAttribute("data-date", dateStr);

          var rec = records[dateStr];
          if (rec) {
            if (rec.type === "supplement") td.classList.add("supplement");
            else if (rec.type === "absent") td.classList.add("absent");
            else td.classList.add("checked");
          }
          if (dateStr === today) td.classList.add("today");

          var cellDate = new Date(y, m, d);
          cellDate.setHours(23, 59, 59, 999);
          if (cellDate.getTime() > todayCutoff.getTime()) {
            td.classList.add("future");
          }
          if (!td.classList.contains("future") || rec) {
            (function (ds) {
              td.addEventListener("click", function () {
                openEdit(ds);
              });
            })(dateStr);
          }
        }

        tr.appendChild(td);
        cellIdx++;
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrap.innerHTML = "";
    wrap.appendChild(table);
  }

  // ---------- 渲染：记录列表 ----------
  function renderRecords() {
    var records = loadRecords();
    var list = safeEl("recordList");
    if (!list) return;
    list.innerHTML = "";

    var entries = [];
    var keys = Object.keys(records);
    for (var i = 0; i < keys.length; i++) {
      entries.push([keys[i], records[keys[i]]]);
    }

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty">暂无打卡记录</div>';
      return;
    }

    if (currentTab === "recent") {
      // 最近10条，按时间倒序
      entries.sort(function (a, b) {
        var ta = a[1] && a[1].timestamp ? a[1].timestamp : 0;
        var tb = b[1] && b[1].timestamp ? b[1].timestamp : 0;
        return tb - ta;
      });
      entries = entries.slice(0, 10);
    } else {
      entries.sort(function (a, b) {
        return b[0].localeCompare(a[0]);
      });
    }

    for (var j = 0; j < entries.length; j++) {
      (function () {
        var date = entries[j][0];
        var info = entries[j][1];
        var dObj = new Date(date + "T00:00:00");
        var isWeekend = dObj.getDay() === 0 || dObj.getDay() === 6;
        var isSupplement = info && info.type === "supplement";
        var isAbsent = info && info.type === "absent";

        var item = document.createElement("div");
        item.className = "record-item";
        if (isSupplement) item.classList.add("supplement");
        if (isAbsent) item.classList.add("absent");
        if (isWeekend) item.classList.add("weekend");

        var tagText =
          isSupplement ? "补签" :
          isAbsent ? "缺勤" : "打卡";
        var tagClass =
          isSupplement ? "supplement" :
          isAbsent ? "absent" : "";
        var noteHtml = info && info.note ? ' · ' + escapeHtml(info.note) : '';
        var timeText = info && info.timestamp ? fmtTime(info.timestamp) : '--:--:--';
        var weekdayHtml =
          "星期" + WEEKDAYS[dObj.getDay()] + (isWeekend ? " · 休息日" : "") + noteHtml;

        var leftDiv = document.createElement("div");
        leftDiv.innerHTML =
          '<div class="record-date">' +
          escapeHtml(date) +
          "</div>" +
          '<div class="record-weekday">' +
          weekdayHtml +
          "</div>";

        var rightDiv = document.createElement("div");
        rightDiv.className = "record-meta";
        rightDiv.innerHTML =
          '<span class="record-tag ' +
          tagClass +
          '">' +
          tagText +
          "</span>" +
          '<span class="record-time">' +
          escapeHtml(timeText) +
          "</span>";

        item.appendChild(leftDiv);
        item.appendChild(rightDiv);

        item.addEventListener("click", function () {
          openEdit(date);
        });

        list.appendChild(item);
      })();
    }
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- 统一刷新 ----------
  function refreshAll() {
    try { renderHeader(); } catch (e) { try { console.error("renderHeader:", e); } catch (_) {} }
    try { renderStatus(); } catch (e) { try { console.error("renderStatus:", e); } catch (_) {} }
    try { renderStats(); } catch (e) { try { console.error("renderStats:", e); } catch (_) {} }
    try { renderCalendar(); } catch (e) { try { console.error("renderCalendar:", e); } catch (_) {} }
    try { renderRecords(); } catch (e) { try { console.error("renderRecords:", e); } catch (_) {} }
    try { renderSalary(); } catch (e) { try { console.error("renderSalary:", e); } catch (_) {} }
  }

  // ---------- 补签 / 编辑面板 ----------
  function openEdit(dateStr) {
    editingDate = dateStr;
    var records = loadRecords();
    var rec = records[dateStr];
    var isToday = dateStr === todayStr();

    var editDate = safeEl("editDate");
    if (editDate) editDate.value = dateStr;

    var title = safeEl("editTitle");
    if (title) title.textContent = rec ? "修改记录" : (isToday ? "今日打卡" : "补签记录");

    editingType = rec
      ? (rec.type || "checkin")
      : (isToday ? "checkin" : "supplement");
    updateTypeButtons();

    var timeInput = safeEl("editTime");
    if (timeInput) {
      if (rec && rec.timestamp) timeInput.value = timeStrFromTs(rec.timestamp);
      else {
        var now = new Date();
        timeInput.value = pad2(now.getHours()) + ":" + pad2(now.getMinutes());
      }
    }

    var noteInput = safeEl("editNote");
    if (noteInput) noteInput.value = (rec && rec.note) ? rec.note : "";

    var mask = safeEl("editMask");
    if (mask) mask.classList.add("show");
  }

  function closeEdit() {
    var mask = safeEl("editMask");
    if (mask) mask.classList.remove("show");
    editingDate = null;
  }

  function updateTypeButtons() {
    var cBtn = safeEl("typeCheckin");
    var sBtn = safeEl("typeSupplement");
    var aBtn = safeEl("typeAbsent");
    if (cBtn) {
      if (editingType === "checkin") cBtn.classList.add("active");
      else cBtn.classList.remove("active");
    }
    if (sBtn) {
      if (editingType === "supplement") sBtn.classList.add("active");
      else sBtn.classList.remove("active");
    }
    if (aBtn) {
      if (editingType === "absent") aBtn.classList.add("active");
      else aBtn.classList.remove("active");
    }
  }

  // ---------- 事件绑定 & 初始化 ----------
  function bindEvents() {
    // 通用弹窗
    var modalCancel = safeEl("modalCancel");
    if (modalCancel) modalCancel.onclick = hideModal;
    var modalOk = safeEl("modalOk");
    if (modalOk) {
      modalOk.onclick = function () {
        if (modalCallback) {
          try { modalCallback(); } catch (e) { try { console.error("modalCallback:", e); } catch (_) {} }
        }
        hideModal();
      };
    }

    // 编辑面板 - 类型切换
    var tBtnC = safeEl("typeCheckin");
    if (tBtnC) tBtnC.onclick = function () { editingType = "checkin"; updateTypeButtons(); };
    var tBtnS = safeEl("typeSupplement");
    if (tBtnS) tBtnS.onclick = function () { editingType = "supplement"; updateTypeButtons(); };
    var tBtnA = safeEl("typeAbsent");
    if (tBtnA) tBtnA.onclick = function () { editingType = "absent"; updateTypeButtons(); };

    var editCancel = safeEl("editCancel");
    if (editCancel) editCancel.onclick = closeEdit;

    var editSave = safeEl("editSave");
    if (editSave) {
      editSave.onclick = function () {
        if (!editingDate) return;
        var timeInput = safeEl("editTime");
        var timeVal = (timeInput && timeInput.value) ? timeInput.value : "09:00";
        var parts = String(timeVal).split(":");
        var hh = parseInt(parts[0], 10) || 0;
        var mm = parseInt(parts[1], 10) || 0;
        var ts = new Date(editingDate + "T00:00:00");
        ts.setHours(hh, mm, 0, 0);
        var noteInput = safeEl("editNote");
        var note = noteInput ? String(noteInput.value || "").trim() : "";
        var records = loadRecords();
        records[editingDate] = {
          timestamp: ts.getTime(),
          type: editingType,
          note: note || undefined
        };
        saveRecords(records);
        showToast(editingType === "supplement" ? "补签成功" : "打卡成功");
        closeEdit();
        refreshAll();
      };
    }

    var editMask = safeEl("editMask");
    if (editMask) {
      editMask.addEventListener("click", function (e) {
        if (e && e.target && e.target.id === "editMask") closeEdit();
      });
    }

    // 主打卡按钮
    var checkinBtn = safeEl("checkinBtn");
    if (checkinBtn) {
      checkinBtn.onclick = function () {
        var records = loadRecords();
        var today = todayStr();
        if (records[today]) {
          showToast("今日已打卡");
          return;
        }
        records[today] = { timestamp: Date.now(), type: "checkin" };
        saveRecords(records);
        showToast("打卡成功！");
        refreshAll();
      };
    }

    // 日薪输入
    var salaryInput = safeEl("dailySalary");
    if (salaryInput) {
      salaryInput.addEventListener("input", function () {
        var settings = loadSettings();
        settings.dailySalary = parseFloat(salaryInput.value) || 0;
        saveSettings(settings);
        try { renderSalary(); } catch (e) { try { console.error("salary input renderSalary:", e); } catch (_) {} }
      });
    }

    // 月份切换
    var prevBtn = safeEl("prevMonth");
    if (prevBtn) prevBtn.onclick = function () {
      viewDate.setMonth(viewDate.getMonth() - 1);
      try { renderCalendar(); } catch (e) { try { console.error("prevMonth:", e); } catch (_) {} }
    };
    var nextBtn = safeEl("nextMonth");
    if (nextBtn) nextBtn.onclick = function () {
      viewDate.setMonth(viewDate.getMonth() + 1);
      try { renderCalendar(); } catch (e) { try { console.error("nextMonth:", e); } catch (_) {} }
    };

    // Tab
    var tabEls = document.querySelectorAll(".tab");
    for (var ti = 0; ti < tabEls.length; ti++) {
      (function (t) {
        t.onclick = function () {
          for (var k = 0; k < tabEls.length; k++) {
            tabEls[k].classList.remove("active");
          }
          t.classList.add("active");
          currentTab = t.getAttribute("data-tab") || "list";
          try { renderRecords(); } catch (e) { try { console.error("tab renderRecords:", e); } catch (_) {} }
        };
      })(tabEls[ti]);
    }

    // 导出
    var exportBtn = safeEl("exportBtn");
    if (exportBtn) {
      exportBtn.onclick = function () {
        try {
          var records = loadRecords();
          var settings = loadSettings();
          var payload = {
            records: records,
            settings: settings,
            exportedAt: new Date().toISOString()
          };
          var json = JSON.stringify(payload, null, 2);
          var blob = new Blob([json], { type: "application/json" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "checkin-backup-" + todayStr() + ".json";
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            try { document.body.removeChild(a); } catch (_) {}
            try { URL.revokeObjectURL(url); } catch (_) {}
          }, 200);
          showToast("数据已导出");
        } catch (e) {
          try { console.error("export:", e); } catch (_) {}
          showToast("导出失败: " + String(e.message || e));
        }
      };
    }

    // 导入
    var importBtn = safeEl("importBtn");
    var fileInput = safeEl("fileInput");
    if (importBtn) {
      importBtn.onclick = function () {
        if (fileInput) fileInput.click();
      };
    }
    if (fileInput) {
      fileInput.onchange = function (e) {
        var file = e && e.target && e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(String(ev.target.result || ""));
            var imported =
              data.records && !data.timestamp ? data.records : (data.records || data);
            if (!imported || typeof imported !== "object") imported = {};
            var importedSettings = data.settings && typeof data.settings === "object" ? data.settings : {};
            var count = Object.keys(imported).length;
            var msg = "将合并导入 " + count + " 条记录" +
              (importedSettings.dailySalary ? " 及日薪设置" : "") +
              "，是否继续？";
            showModal("确认导入", msg, function () {
              var records = loadRecords();
              var ks = Object.keys(imported);
              for (var i = 0; i < ks.length; i++) records[ks[i]] = imported[ks[i]];
              saveRecords(records);
              if (importedSettings.dailySalary != null) {
                var settings = loadSettings();
                settings.dailySalary = importedSettings.dailySalary;
                saveSettings(settings);
              }
              refreshAll();
              showToast("导入成功");
            });
          } catch (err) {
            try { console.error("import parse:", err); } catch (_) {}
            showToast("文件格式错误");
          }
        };
        reader.onerror = function () {
          showToast("读取文件失败");
        };
        reader.readAsText(file, "utf-8");
        // 允许下次选择同一文件
        try { fileInput.value = ""; } catch (_) {}
      };
    }

    // 清空
    var clearBtn = safeEl("clearBtn");
    if (clearBtn) {
      clearBtn.onclick = function () {
        showModal(
          "清空记录",
          "确定要清空所有打卡记录吗？（日薪设置会保留）此操作不可恢复！",
          function () {
            try {
              localStorage.removeItem(RECORDS_KEY);
            } catch (e) {
              try { console.error("clear removeItem:", e); } catch (_) {}
            }
            refreshAll();
            showToast("记录已清空");
          }
        );
      };
    }
  }

  // DOM 就绪
  function main() {
    try { bindEvents(); } catch (e) { try { console.error("bindEvents:", e); } catch (_) {} }
    try { refreshAll(); } catch (e) { try { console.error("initial refreshAll:", e); } catch (_) {} }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    // 已经加载完（比如脚本被延迟插入），直接执行
    main();
  }
})();
