/* APEX WHEELS prototype: minimal vanilla JS for demo interactions only. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* Selector tabs (APG tabs: arrows, Home/End) */
  var tabs = $$('[role="tab"]');
  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { selectTab(tab, false); });
    tab.addEventListener("keydown", function (e) {
      var n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (n === undefined) return;
      e.preventDefault();
      selectTab(tabs[(n + tabs.length) % tabs.length], true);
    });
  });

  /* Size form: kind switch + CTA label */
  var form = $("[data-size-form]");
  if (form) {
    var cta = $("[data-size-cta]", form);
    var update = function () {
      var kind = form.querySelector('input[name="kind"]:checked').value;
      $$("[data-kind-panel]", form).forEach(function (p) { p.hidden = p.getAttribute("data-kind-panel") !== kind; });
      cta.textContent = kind === "tire"
        ? "Показать шины " + $("#w").value + "/" + $("#p").value + " R" + $("#d").value
        : "Показать диски R" + $("#wd").value + " · " + $("#pcd").value;
    };
    form.addEventListener("change", update);
    update();
  }
  var make = $("#make"), model = $("#model");
  if (make && model) make.addEventListener("change", function () {
    model.disabled = !make.value;
    model.innerHTML = make.value ? "<option>Выберите модель</option><option>Модель 1 (демо)</option><option>Модель 2 (демо)</option>" : "<option>Сначала выберите марку</option>";
  });

  /* Mobile menu */
  var menuBtn = $("[data-menu-toggle]"), menu = $("#mobile-menu");
  function setMenu(open) {
    if (!menu) return;
    menu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
    $("[data-menu-label]").textContent = open ? "Закрыть меню" : "Открыть меню";
  }
  if (menuBtn) menuBtn.addEventListener("click", function () { setMenu(menu.hidden); });
  var searchBtn = $("[data-menu-search]");
  if (searchBtn) searchBtn.addEventListener("click", function () { setMenu(true); $("#q-m").focus(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu && !menu.hidden) { setMenu(false); menuBtn.focus(); }
  });

  /* Cookie bar */
  $$("[data-cookie-close]").forEach(function (b) {
    b.addEventListener("click", function () { $("[data-cookie]").hidden = true; });
  });

  /* Toasts (live region is persistent) */
  var region = $(".toast-region"), toastTimer = null;
  function toast(text) {
    if (!region) return;
    clearTimeout(toastTimer);
    region.innerHTML = '<div class="toast"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg><span></span></div>';
    region.querySelector("span").textContent = text;
    toastTimer = setTimeout(function () { region.innerHTML = ""; }, 4000);
  }

  /* Favourites / compare toggles */
  var counts = { fav: 0, cmp: 0 };
  function syncCount(kind) {
    var n = counts[kind];
    $$("[data-" + kind + "-count]").forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
    $$("[data-" + kind + "-count-m]").forEach(function (el) { el.textContent = n; });
    var link = $("[data-" + kind + "-link]");
    if (link) link.setAttribute("aria-label", (kind === "fav" ? "Избранное" : "Сравнение") + ", " + n + " товаров");
  }
  ["fav", "cmp"].forEach(function (kind) {
    $$("[data-" + kind + "]").forEach(function (b) {
      b.addEventListener("click", function () {
        var on = b.getAttribute("aria-pressed") !== "true";
        b.setAttribute("aria-pressed", String(on));
        var label = b.getAttribute("aria-label").split(": ")[1];
        b.setAttribute("aria-label", (kind === "fav" ? (on ? "Убрать из избранного: " : "В избранное: ") : (on ? "Убрать из сравнения: " : "Сравнить: ")) + label);
        counts[kind] += on ? 1 : -1;
        syncCount(kind);
      });
    });
  });

  /* Cart */
  var cart = [], dialog = $("#cart-dialog");
  function renderCart() {
    var total = cart.reduce(function (s, l) { return s + l.qty; }, 0);
    $$("[data-cart-count]").forEach(function (el) { el.textContent = total; });
    if (!dialog || !cart.length) return;
    var body = $("[data-cart-body]", dialog);
    body.innerHTML = "";
    cart.forEach(function (l) {
      var row = document.createElement("div");
      row.className = "line-item";
      row.innerHTML = '<img alt="" src="' + l.img + '"><div><strong></strong><p class="size-mark muted"></p></div>';
      row.querySelector("strong").textContent = l.name;
      row.querySelector("p").textContent = l.size + " · " + l.qty + " шт.";
      body.appendChild(row);
    });
    $(".dialog__foot .btn", dialog).disabled = false;
  }
  $$("[data-buy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var card = b.closest(".card");
      var name = card ? card.getAttribute("data-name") : b.getAttribute("data-name");
      var size = card ? card.getAttribute("data-size") : b.getAttribute("data-size");
      var img = card ? card.querySelector("img").getAttribute("src") : ($(".pdp__media img") || {}).getAttribute("src");
      var qtyEl = $("[data-qty-value]");
      var qty = card ? 1 : (qtyEl ? +qtyEl.textContent : 1);
      cart.push({ name: name, size: size, qty: qty, img: img });
      renderCart();
      toast("Добавлено в корзину: " + name + ", " + qty + " шт.");
    });
  });
  $$("[data-cart-open]").forEach(function (b) {
    b.addEventListener("click", function () { if (dialog && dialog.showModal) dialog.showModal(); });
  });
  $$("[data-cart-close]").forEach(function (b) { b.addEventListener("click", function () { dialog.close(); }); });

  /* Product page: sticky buy bar only when the main buy block is off-screen */
  var sticky = $("[data-sticky-buy]"), buyBlock = $(".pdp__buy");
  if (sticky && buyBlock && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      sticky.hidden = entries[0].isIntersecting || entries[0].boundingClientRect.top > 0;
    }).observe(buyBlock);
  }

  /* Quantity stepper (1–8) */
  var qv = $("[data-qty-value]");
  $$("[data-qty]").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = Math.min(8, Math.max(1, +qv.textContent + +b.getAttribute("data-qty")));
      qv.textContent = v;
      var total = $("[data-total]");
      if (total) total.textContent = (17390 * v).toLocaleString("ru-RU").replace(/\s/g, " ") + " ₽";
      $$("[data-qty]").forEach(function (x) { x.disabled = (+x.getAttribute("data-qty") < 0 && v === 1) || (+x.getAttribute("data-qty") > 0 && v === 8); });
    });
  });

  /* Catalog filters + sort */
  var grid = $("[data-grid]");
  if (grid) {
    var cards = $$(".card", grid), empty = $("[data-empty]"), result = $("[data-result]");
    var apply = function () {
      var active = $$("[data-chip][aria-pressed='true']").map(function (c) { return c.getAttribute("data-chip"); });
      var seasons = active.filter(function (a) { return a.indexOf("season:") === 0; }).map(function (a) { return a.slice(7); });
      var flags = active.filter(function (a) { return a.indexOf("season:") !== 0; });
      var n = 0;
      cards.forEach(function (c) {
        var ok = (!seasons.length || seasons.indexOf(c.getAttribute("data-season")) > -1) &&
          flags.every(function (f) { return c.getAttribute("data-" + f) === "true"; });
        c.hidden = !ok;
        if (ok) n += 1;
      });
      result.textContent = n;
      empty.hidden = n > 0;
      grid.hidden = n === 0;
    };
    $$("[data-chip]").forEach(function (c) {
      c.addEventListener("click", function () { c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); apply(); });
    });
    var reset = $("[data-reset]");
    if (reset) reset.addEventListener("click", function () { $$("[data-chip]").forEach(function (c) { c.setAttribute("aria-pressed", "false"); }); apply(); });
    $$("[data-filter-link]").forEach(function (a) {
      a.addEventListener("click", function () {
        var key = "season:" + a.getAttribute("data-filter-link");
        $$("[data-chip]").forEach(function (c) { c.setAttribute("aria-pressed", String(c.getAttribute("data-chip") === key)); });
        apply();
      });
    });
    var order = cards.slice();
    var sort = $("[data-sort]");
    if (sort) sort.addEventListener("change", function () {
      var list = order.slice();
      if (sort.value !== "season") list.sort(function (a, b) { var d = +a.getAttribute("data-price") - +b.getAttribute("data-price"); return sort.value === "asc" ? d : -d; });
      list.forEach(function (c) { grid.appendChild(c); });
    });
  }
})();
