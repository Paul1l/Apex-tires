/* Демонстрационный скрипт прототипа. Без зависимостей; только чтобы показать поведение. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var rub = function (n) { return new Intl.NumberFormat("ru-RU").format(n) + " ₽"; };
  var plural = function (n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* без хранилища */ } }
  };
  var live = $("[data-live]");
  var announce = function (text) { if (live) { live.textContent = ""; setTimeout(function () { live.textContent = text; }, 30); } };

  /* ---------- Счётчики в шапке ---------- */

  var cartCountEl = $("[data-cart-count]");
  var cart = {
    count: cartCountEl ? Number(cartCountEl.textContent) || 0 : 0,
    sum: 0
  };
  if (document.body.querySelector("[data-cart-items]")) {
    $$("[data-cart-item]").forEach(function (row) {
      cart.sum += Number(row.dataset.price) * Number($("input", row).value);
    });
  }
  function renderCart() {
    if (!cartCountEl) return;
    cartCountEl.textContent = cart.count;
    cartCountEl.dataset.zero = String(cart.count === 0);
    $("[data-cart-sum]").textContent = cart.count ? rub(cart.sum) : "Корзина";
    $("[data-cart-sr]").textContent = "Корзина: " + cart.count + " шт., " + rub(cart.sum);
  }

  var toast = $("[data-toast]");
  var toastTimer;
  function showToast(html) {
    if (!toast) return;
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 3500);
  }

  function addToCart(qty, price, name, button) {
    cart.count += qty;
    cart.sum += qty * price;
    renderCart();
    if (button) {
      button.classList.add("is-added");
      button.textContent = "В корзине";
    }
    showToast("Добавлено: " + name + ", " + qty + " шт.<a href=\"cart.html\">Перейти в корзину</a>");
    announce("Добавлено в корзину: " + name + ", " + qty + " шт. В корзине " + cart.count + " шт.");
  }

  /* ---------- Количество ---------- */

  document.addEventListener("click", function (e) {
    var stepBtn = e.target.closest("[data-step]");
    if (!stepBtn) return;
    var input = $("input", stepBtn.parentElement);
    var next = Math.min(99, Math.max(1, (Number(input.value) || 1) + Number(stepBtn.dataset.step)));
    input.value = next;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  /* ---------- В корзину / избранное / сравнение ---------- */

  document.addEventListener("click", function (e) {
    var add = e.target.closest("[data-add]");
    if (add) {
      var holder = add.closest("[data-price]");
      var qtyInput = $(".stepper input", add.parentElement);
      addToCart(Number(qtyInput.value) || 1, Number(holder.dataset.price), holder.dataset.name, add);
      return;
    }
    var sticky = e.target.closest("[data-sticky-add]");
    if (sticky) {
      var box = $("[data-buybox]");
      var q = Number($(".stepper input", box).value) || 1;
      addToCart(q, Number(box.dataset.price), box.dataset.name, $("[data-main-add]"));
      sticky.textContent = "В корзине";
      sticky.classList.add("is-added");
      return;
    }
    var toggle = e.target.closest("[data-fav], [data-cmp]");
    if (toggle) {
      var on = toggle.getAttribute("aria-pressed") !== "true";
      toggle.setAttribute("aria-pressed", String(on));
      var isFav = toggle.hasAttribute("data-fav");
      var counter = $(isFav ? "[data-fav-count]" : "[data-cmp-count]");
      var n = $$(isFav ? "[data-fav][aria-pressed=true]" : "[data-cmp][aria-pressed=true]").length;
      if (counter) { counter.textContent = n; counter.dataset.zero = String(n === 0); }
      announce((isFav ? "Избранное: " : "Сравнение: ") + n);
    }
  });

  /* ---------- Вкладки ---------- */

  function selectTab(tab, focus) {
    var list = tab.closest("[role=tablist]");
    $$("[role=tab]", list).forEach(function (t) {
      var active = t === tab;
      t.setAttribute("aria-selected", String(active));
      t.tabIndex = active ? 0 : -1;
      var panel = document.getElementById(t.getAttribute("aria-controls"));
      if (panel) panel.hidden = !active;
    });
    if (focus) tab.focus();
  }
  $$("[role=tablist]").forEach(function (list) {
    list.addEventListener("click", function (e) {
      var tab = e.target.closest("[role=tab]");
      if (tab) selectTab(tab, false);
    });
    list.addEventListener("keydown", function (e) {
      var tabs = $$("[role=tab]", list);
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === "Home") next = tabs[0];
      if (e.key === "End") next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); selectTab(next, true); }
    });
  });
  $$("[data-goto-tab]").forEach(function (link) {
    link.addEventListener("click", function () { selectTab(document.getElementById(link.dataset.gotoTab), false); });
  });

  var helpBtn = $("[data-size-help-btn]");
  if (helpBtn) {
    helpBtn.addEventListener("click", function () {
      var box = document.getElementById(helpBtn.getAttribute("aria-controls"));
      var open = box.hidden;
      box.hidden = !open;
      helpBtn.setAttribute("aria-expanded", String(open));
    });
  }

  /* ---------- Выдвижные панели ---------- */

  var scrim = $("[data-scrim]");
  var openPanel = null;
  var lastTrigger = null;
  function focusables(el) {
    return $$("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea", el)
      .filter(function (x) { return x.offsetParent !== null; });
  }
  function openDrawer(panel, trigger) {
    openPanel = panel;
    lastTrigger = trigger;
    panel.classList.add("is-open");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    scrim.hidden = false;
    document.body.style.overflow = "hidden";
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    var f = focusables(panel);
    if (f.length) f[0].focus();
  }
  function closeDrawer() {
    if (!openPanel) return;
    openPanel.classList.remove("is-open");
    if (openPanel.id === "filters") { openPanel.removeAttribute("role"); openPanel.removeAttribute("aria-modal"); }
    scrim.hidden = true;
    document.body.style.overflow = "";
    if (lastTrigger) { lastTrigger.setAttribute("aria-expanded", "false"); lastTrigger.focus(); }
    openPanel = null;
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-open-filters]");
    if (t) return openDrawer($("[data-filters]"), t);
    t = e.target.closest("[data-open-menu]");
    if (t) return openDrawer($("#menu"), t);
    if (e.target.closest("[data-close-filters], [data-close-menu]") || e.target === scrim) closeDrawer();
  });
  document.addEventListener("keydown", function (e) {
    if (!openPanel) return;
    if (e.key === "Escape") { closeDrawer(); return; }
    if (e.key === "Tab") {
      var f = focusables(openPanel);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  window.addEventListener("resize", function () {
    if (openPanel && window.innerWidth >= 1100 && openPanel.id === "filters") closeDrawer();
    if (openPanel && window.innerWidth >= 768 && openPanel.id === "menu") closeDrawer();
  });

  /* ---------- Каталог: фильтры, сортировка, вид ---------- */

  var catalog = $("[data-catalog]");
  if (catalog) initCatalog();

  function initCatalog() {
    var form = $("[data-filter-form]");
    var list = $("[data-products]");
    var cards = $$(".card", list);
    cards.forEach(function (c, i) { c.dataset.order = i; });
    var chipsBox = $("[data-chips]");
    var found = $("[data-found]");
    var showBtn = $("[data-show-btn]");
    var activeCount = $("[data-active-count]");
    var empty = $("[data-empty]");
    var sortSel = $("[data-sort]");
    var extra = { query: "", car: "" };

    var norm = function (s) { return String(s).toLowerCase().replace(/[\s\/\-×.,]/g, ""); };
    var labels = {
      season: { summer: "Летние", winter: "Зимние", "all-season": "Всесезонные" },
      studs: { yes: "Шипованные", no: "Нешипованные" }
    };

    function readState() {
      var fd = new FormData(form);
      return {
        season: fd.getAll("season"),
        studs: fd.getAll("studs"),
        brand: fd.getAll("brand"),
        width: fd.get("width"),
        profile: fd.get("profile"),
        diameter: fd.get("diameter"),
        priceMin: Number(fd.get("priceMin")) || 0,
        priceMax: Number(fd.get("priceMax")) || 0,
        runflat: fd.get("runflat") === "1",
        xl: fd.get("xl") === "1",
        instock: fd.get("instock") === "1"
      };
    }

    function matches(c, s) {
      var d = c.dataset;
      if (s.season.length && s.season.indexOf(d.season) < 0) return false;
      if (s.studs.length && s.studs.indexOf(d.studded) < 0) return false;
      if (s.brand.length && s.brand.indexOf(d.brand) < 0) return false;
      if (s.width && d.width !== s.width) return false;
      if (s.profile && d.profile !== s.profile) return false;
      if (s.diameter && d.diameter !== s.diameter) return false;
      if (s.priceMin && Number(d.price) < s.priceMin) return false;
      if (s.priceMax && Number(d.price) > s.priceMax) return false;
      if (s.runflat && d.runflat !== "1") return false;
      if (s.xl && d.xl !== "1") return false;
      if (s.instock && !(Number(d.stock) > 0)) return false;
      if (extra.car && d.cars.split("|").indexOf(extra.car) < 0) return false;
      if (extra.query) {
        var hay = norm(d.search);
        var q = norm(extra.query);
        if (hay.indexOf(q) < 0 && hay.indexOf(q.replace(/r(?=\d)/g, "")) < 0 && hay.replace(/r(?=\d)/g, "").indexOf(q) < 0) return false;
      }
      return true;
    }

    function chip(text, onRemove) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.innerHTML = text + '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
      b.setAttribute("aria-label", "Убрать фильтр: " + text);
      b.addEventListener("click", onRemove);
      chipsBox.appendChild(b);
    }
    function uncheck(name, value) {
      var el = form.querySelector('[name="' + name + '"][value="' + value + '"]');
      if (el) el.checked = false;
      apply();
    }
    function clearField(name) { form.elements[name].value = ""; apply(); }

    function renderChips(s) {
      chipsBox.innerHTML = "";
      var n = 0;
      if (extra.query) { n++; chip("Поиск: " + extra.query, function () { extra.query = ""; $("#q").value = ""; apply(); }); }
      if (extra.car) { n++; chip("Автомобиль: " + extra.car, function () { extra.car = ""; apply(); }); }
      s.season.forEach(function (v) { n++; chip(labels.season[v], function () { uncheck("season", v); }); });
      s.studs.forEach(function (v) { n++; chip(labels.studs[v], function () { uncheck("studs", v); }); });
      if (s.width) { n++; chip("Ширина " + s.width, function () { clearField("width"); }); }
      if (s.profile) { n++; chip("Профиль " + s.profile, function () { clearField("profile"); }); }
      if (s.diameter) { n++; chip("R" + s.diameter, function () { clearField("diameter"); }); }
      s.brand.forEach(function (v) { n++; chip(v, function () { uncheck("brand", v); }); });
      if (s.priceMin) { n++; chip("от " + rub(s.priceMin), function () { clearField("priceMin"); }); }
      if (s.priceMax) { n++; chip("до " + rub(s.priceMax), function () { clearField("priceMax"); }); }
      if (s.runflat) { n++; chip("RunFlat", function () { uncheck("runflat", "1"); }); }
      if (s.xl) { n++; chip("Усиленные (XL)", function () { uncheck("xl", "1"); }); }
      if (s.instock) { n++; chip("В наличии", function () { uncheck("instock", "1"); }); }
      if (n > 1) {
        var r = document.createElement("button");
        r.type = "button";
        r.className = "link-btn";
        r.textContent = "Сбросить все";
        r.addEventListener("click", resetAll);
        chipsBox.appendChild(r);
      }
      activeCount.textContent = n ? " (" + n + ")" : "";
    }

    function sortCards() {
      var mode = sortSel.value;
      var sorted = cards.slice().sort(function (a, b) {
        if (mode === "price-asc") return a.dataset.price - b.dataset.price;
        if (mode === "price-desc") return b.dataset.price - a.dataset.price;
        if (mode === "name") return a.dataset.name.localeCompare(b.dataset.name, "ru");
        return a.dataset.order - b.dataset.order;
      });
      sorted.forEach(function (c) { list.appendChild(c); });
    }

    function apply() {
      var s = readState();
      var n = 0;
      cards.forEach(function (c) { var ok = matches(c, s); c.hidden = !ok; if (ok) n++; });
      var word = plural(n, "товар", "товара", "товаров");
      found.textContent = "Найдено " + n + " " + word;
      showBtn.textContent = n ? "Показать " + n + " " + word : "Ничего не найдено";
      empty.hidden = n > 0;
      list.hidden = n === 0;
      renderChips(s);
    }

    function resetAll() {
      form.reset();
      extra.query = "";
      extra.car = "";
      var q = $("#q"); if (q) q.value = "";
      apply();
    }

    form.addEventListener("change", apply);
    form.addEventListener("input", function (e) { if (e.target.type === "number") apply(); });
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    $$("[data-reset]").forEach(function (b) { b.addEventListener("click", resetAll); });
    sortSel.addEventListener("change", sortCards);

    /* вид: сетка / список */
    function setView(view) {
      catalog.classList.toggle("is-list", view === "list");
      $$("[data-view]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.view === view)); });
      store.set("apex-view", view);
    }
    $$("[data-view]").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.view); }); });
    var urlView = new URLSearchParams(location.search).get("view");
    setView(urlView || store.get("apex-view") || "grid");

    /* подбор по размеру → фильтры каталога */
    var sizeForm = $("[data-picker-size]");
    sizeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(sizeForm);
      ["width", "profile", "diameter"].forEach(function (k) {
        var sel = form.elements[k];
        var v = fd.get(k);
        var has = $$("option", sel).some(function (o) { return o.value === v; });
        sel.value = has ? v : "";
        if (v && !has) { /* такого размера нет в демо-каталоге */
          sel.value = "";
          extra.query = (fd.get("width") || "") + "/" + (fd.get("profile") || "") + " R" + (fd.get("diameter") || "");
        }
      });
      $$('[name="season"]', form).forEach(function (cb) { cb.checked = cb.value === fd.get("season"); });
      apply();
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
      announce(found.textContent);
    });

    /* подбор по автомобилю (марки и модели из демо-данных применяемости) */
    var carMap = {};
    cards.forEach(function (c) {
      c.dataset.cars.split("|").forEach(function (car) {
        var make = /^(Mercedes-Benz|Land Rover)/.test(car) ? car.match(/^(Mercedes-Benz|Land Rover)/)[0] : car.split(" ")[0];
        (carMap[make] = carMap[make] || {})[car] = true;
      });
    });
    var makeSel = $("[data-make]");
    var modelSel = $("[data-model]");
    Object.keys(carMap).sort().forEach(function (m) { makeSel.add(new Option(m, m)); });
    makeSel.addEventListener("change", function () {
      modelSel.innerHTML = "";
      if (!makeSel.value) {
        modelSel.add(new Option("Сначала выберите марку", ""));
        modelSel.disabled = true;
        return;
      }
      modelSel.add(new Option("Выберите модель", ""));
      Object.keys(carMap[makeSel.value]).sort().forEach(function (car) {
        modelSel.add(new Option(car.slice(makeSel.value.length + 1), car));
      });
      modelSel.disabled = false;
    });
    $("[data-picker-car]").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!modelSel.value) { (makeSel.value ? modelSel : makeSel).focus(); return; }
      extra.car = modelSel.value;
      apply();
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
      announce(found.textContent);
    });

    /* поиск в шапке */
    var searchForm = $("[data-search-form]");
    searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      extra.query = $("#q").value.trim();
      apply();
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    var params = new URLSearchParams(location.search);
    if (params.get("q")) { extra.query = params.get("q"); $("#q").value = extra.query; }
    if (params.get("filters") === "open") {
      setTimeout(function () { openDrawer($("[data-filters]"), $("[data-open-filters]")); }, 0);
    }
    if (params.get("demo") === "winter") {
      form.querySelector('[name="season"][value="winter"]').checked = true;
    }
    apply();
  }

  /* ---------- Корзина ---------- */

  var cartItems = $("[data-cart-items]");
  if (cartItems) initCart();

  function initCart() {
    function recalc() {
      var count = 0, sum = 0, rows = $$("[data-cart-item]");
      rows.forEach(function (row) {
        var q = Number($("input", row).value) || 1;
        var line = q * Number(row.dataset.price);
        $("[data-line-sum]", row).textContent = rub(line);
        count += q; sum += line;
      });
      cart.count = count; cart.sum = sum;
      renderCart();
      $("[data-sum-count]").textContent = count;
      $("[data-sum-goods]").textContent = rub(sum);
      $("[data-sum-total]").textContent = rub(sum);
      $("[data-cart-caption]").textContent = rows.length
        ? rows.length + " " + plural(rows.length, "товар", "товара", "товаров") + ", " + count + " шт."
        : "Корзина пуста";
    }
    cartItems.addEventListener("change", recalc);
    cartItems.addEventListener("click", function (e) {
      var rm = e.target.closest("[data-remove]");
      if (!rm) return;
      var row = rm.closest("[data-cart-item]");
      var name = $(".cart-item__name", row).textContent;
      row.remove();
      recalc();
      announce("Удалено из корзины: " + name);
    });
    $("[data-clear-cart]").addEventListener("click", function () {
      $$("[data-cart-item]").forEach(function (r) { r.remove(); });
      recalc();
      announce("Корзина очищена");
    });

    var checkout = $("[data-checkout]");
    var address = $("[data-address]");
    var deliveryLabel = { pickup: "Самовывоз", city: "Доставка по Барнаулу", tk: "Транспортная компания" };
    checkout.addEventListener("change", function (e) {
      if (e.target.name === "delivery") {
        address.hidden = e.target.value === "pickup";
        $("[data-sum-delivery]").textContent = deliveryLabel[e.target.value];
      }
    });

    function setError(input, errEl, text) {
      input.setAttribute("aria-invalid", text ? "true" : "false");
      errEl.textContent = text;
    }
    checkout.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("#f-name"), phone = $("#f-phone"), addr = $("#f-address");
      var consent = document.querySelector('[name="consent"]');
      var invalid = [];
      setError(name, $("#f-name-err"), name.value.trim() ? "" : "Укажите имя");
      if (!name.value.trim()) invalid.push(name);
      var digits = phone.value.replace(/\D/g, "");
      setError(phone, $("#f-phone-err"), digits.length >= 10 ? "" : "Укажите телефон: 10 цифр после +7");
      if (digits.length < 10) invalid.push(phone);
      if (!address.hidden && !addr.value.trim()) { addr.setAttribute("aria-invalid", "true"); invalid.push(addr); }
      else addr.setAttribute("aria-invalid", "false");
      setError(consent, $("#consent-err"), consent.checked ? "" : "Нужно согласие, чтобы отправить заказ");
      if (!consent.checked) invalid.push(consent);
      var alert = $("[data-form-alert]");
      if (invalid.length) {
        alert.hidden = false;
        alert.textContent = "Проверьте поля: " + invalid.length + " " + plural(invalid.length, "ошибка", "ошибки", "ошибок") + ".";
        invalid[0].focus();
        return;
      }
      alert.hidden = false;
      alert.style.borderColor = "var(--c-success)";
      alert.style.color = "var(--c-success)";
      alert.textContent = "Демо: заказ не отправляется. В рабочей версии здесь будет номер заказа.";
    });
    recalc();
  }

  /* липкая панель «В корзину» на мобиле: видна, пока основная кнопка вне экрана */
  var stickyBar = $(".sticky-buy");
  var mainAdd = $("[data-main-add]");
  if (stickyBar && mainAdd && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      stickyBar.hidden = entries[0].isIntersecting;
    }).observe(mainAdd);
  }

  renderCart();
})();
