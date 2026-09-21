let state = { user: null, companies: [], activeCompanyId: null };

function fmtMoney(cents, currency) {
  const symbols = { EUR: "€", USD: "$", GBP: "£" };
  const s = symbols[currency] || currency + " ";
  return `${s}${(cents / 100).toFixed(2)}`;
}

async function init() {
  const me = await requireLogin();
  state.user = me.user;
  document.getElementById("userEmail").textContent = me.user.email;
  document.getElementById("logoutBtn").onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/index.html";
  };

  await loadCompanies(me.active_company_id);

  document.getElementById("newCompanyBtn").onclick = toggleNewCompanyForm;
  document.getElementById("newClientBtn").onclick = toggleNewClientForm;
  document.getElementById("companySelect").onchange = async (e) => {
    await api(`/api/companies/${e.target.value}/activate`, { method: "POST" });
    state.activeCompanyId = e.target.value;
    updateSettingsLink();
    await loadClientsAndInvoices();
  };
}

function updateSettingsLink() {
  document.getElementById("settingsLink").href = `company-settings.html?id=${state.activeCompanyId}`;
  document.getElementById("newInvoiceLink").href = `invoice-editor.html?company_id=${state.activeCompanyId}`;
}

async function loadCompanies(preferredId) {
  const data = await api("/api/companies");
  state.companies = data.companies;
  const select = document.getElementById("companySelect");
  select.innerHTML = "";

  if (state.companies.length === 0) {
    select.innerHTML = "<option>No companies yet — create one below</option>";
    toggleNewCompanyForm(true);
    return;
  }

  for (const co of state.companies) {
    const opt = document.createElement("option");
    opt.value = co.id;
    opt.textContent = co.trade_name || co.legal_name;
    select.appendChild(opt);
  }

  state.activeCompanyId = preferredId && state.companies.some((c) => c.id === preferredId)
    ? preferredId
    : state.companies[0].id;
  select.value = state.activeCompanyId;
  updateSettingsLink();
  await loadClientsAndInvoices();
}

function toggleNewCompanyForm(forceOpen) {
  const el = document.getElementById("newCompanyForm");
  const show = forceOpen === true || el.style.display === "none";
  if (!show) { el.style.display = "none"; return; }
  el.style.display = "block";
  el.innerHTML = `
    <h3>New company</h3>
    <div class="row">
      <div><label>Legal name *</label><input id="c_legal_name" /></div>
      <div><label>Trade name</label><input id="c_trade_name" /></div>
    </div>
    <label>Address *</label><input id="c_address" />
    <div class="row">
      <div><label>Postal code *</label><input id="c_postal" /></div>
      <div><label>City *</label><input id="c_city" /></div>
      <div><label>Country</label><input id="c_country" value="Nederland" /></div>
    </div>
    <div class="row">
      <div><label>KvK number *</label><input id="c_kvk" /></div>
      <div><label>VAT (BTW) number</label><input id="c_vat" /></div>
    </div>
    <div class="row">
      <div>
        <label>VAT scheme</label>
        <select id="c_scheme">
          <option value="standard">Standard VAT</option>
          <option value="kor">KOR (VAT-exempt small business)</option>
          <option value="reverse_charge">Reverse-charge by default</option>
        </select>
      </div>
      <div><label>Default currency</label>
        <select id="c_currency">
          <option>EUR</option><option>USD</option><option>GBP</option><option>CHF</option>
          <option>SEK</option><option>NOK</option><option>DKK</option>
        </select>
      </div>
    </div>
    <label>IBAN</label><input id="c_iban" />
    <div style="margin-top:16px;">
      <button class="btn" id="c_save">Create company</button>
      <button class="btn secondary" id="c_cancel">Cancel</button>
    </div>
    <div class="error" id="c_error"></div>
  `;
  document.getElementById("c_cancel").onclick = () => (el.style.display = "none");
  document.getElementById("c_save").onclick = async () => {
    const errorEl = document.getElementById("c_error");
    errorEl.textContent = "";
    try {
      await api("/api/companies", {
        method: "POST",
        body: JSON.stringify({
          legal_name: document.getElementById("c_legal_name").value,
          trade_name: document.getElementById("c_trade_name").value || null,
          address_line1: document.getElementById("c_address").value,
          postal_code: document.getElementById("c_postal").value,
          city: document.getElementById("c_city").value,
          country: document.getElementById("c_country").value,
          kvk_number: document.getElementById("c_kvk").value,
          vat_number: document.getElementById("c_vat").value || null,
          vat_scheme: document.getElementById("c_scheme").value,
          default_currency: document.getElementById("c_currency").value,
          iban: document.getElementById("c_iban").value || null,
        }),
      });
      el.style.display = "none";
      await loadCompanies();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };
}

function toggleNewClientForm() {
  const el = document.getElementById("newClientForm");
  const show = el.style.display === "none";
  if (!show) { el.style.display = "none"; return; }
  el.style.display = "block";
  el.innerHTML = `
    <div class="row">
      <div><label>Name *</label><input id="cl_name" /></div>
      <div><label>Contact person</label><input id="cl_contact" /></div>
    </div>
    <label>Address *</label><input id="cl_address" />
    <div class="row">
      <div><label>Postal code *</label><input id="cl_postal" /></div>
      <div><label>City *</label><input id="cl_city" /></div>
      <div><label>Country</label><input id="cl_country" value="Nederland" /></div>
    </div>
    <div class="row">
      <div><label>VAT number (EU B2B)</label><input id="cl_vat" /></div>
      <div><label>Email</label><input id="cl_email" /></div>
    </div>
    <div style="margin-top:16px;">
      <button class="btn" id="cl_save">Add client</button>
      <button class="btn secondary" id="cl_cancel">Cancel</button>
    </div>
    <div class="error" id="cl_error"></div>
  `;
  document.getElementById("cl_cancel").onclick = () => (el.style.display = "none");
  document.getElementById("cl_save").onclick = async () => {
    const errorEl = document.getElementById("cl_error");
    errorEl.textContent = "";
    try {
      await api("/api/clients", {
        method: "POST",
        body: JSON.stringify({
          company_id: state.activeCompanyId,
          name: document.getElementById("cl_name").value,
          contact_name: document.getElementById("cl_contact").value || null,
          address_line1: document.getElementById("cl_address").value,
          postal_code: document.getElementById("cl_postal").value,
          city: document.getElementById("cl_city").value,
          country: document.getElementById("cl_country").value,
          vat_number: document.getElementById("cl_vat").value || null,
          email: document.getElementById("cl_email").value || null,
          is_eu_business: !!document.getElementById("cl_vat").value,
        }),
      });
      el.style.display = "none";
      await loadClientsAndInvoices();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };
}

async function loadClientsAndInvoices() {
  if (!state.activeCompanyId) return;

  const clientsData = await api(`/api/clients?company_id=${state.activeCompanyId}`);
  const clientsBody = document.getElementById("clientsBody");
  clientsBody.innerHTML = clientsData.clients
    .map(
      (cl) => `<tr>
        <td>${escapeHtml(cl.name)}</td>
        <td>${escapeHtml(cl.city)}</td>
        <td>${escapeHtml(cl.vat_number || "—")}</td>
        <td></td>
      </tr>`
    )
    .join("") || `<tr><td colspan="4" class="muted">No clients yet.</td></tr>`;

  const invoicesData = await api(`/api/invoices?company_id=${state.activeCompanyId}`);
  const invoicesBody = document.getElementById("invoicesBody");
  invoicesBody.innerHTML = invoicesData.invoices
    .map(
      (inv) => `<tr>
        <td>${escapeHtml(inv.invoice_number)}</td>
        <td>${escapeHtml(inv.invoice_date)}</td>
        <td>${escapeHtml(inv.client_name)}</td>
        <td>${fmtMoney(inv.total_amount, inv.currency)}</td>
        <td><a href="/api/invoices/${inv.id}/pdf" target="_blank">Download PDF</a></td>
      </tr>`
    )
    .join("") || `<tr><td colspan="5" class="muted">No invoices yet.</td></tr>`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

init();
