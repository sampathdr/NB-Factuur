const params = new URLSearchParams(window.location.search);
const companyId = params.get("company_id");
let itemCount = 0;

function addItemRow(values = {}) {
  itemCount++;
  const id = itemCount;
  const wrap = document.getElementById("itemsWrap");
  const row = document.createElement("div");
  row.className = "items-row";
  row.dataset.id = id;
  row.innerHTML = `
    <div><label>Description</label><input class="i_desc" value="${values.description || ""}" /></div>
    <div><label>Qty</label><input class="i_qty" type="number" step="0.01" value="${values.quantity ?? 1}" /></div>
    <div><label>Unit price</label><input class="i_price" type="number" step="0.01" value="${values.unit_price ?? ""}" /></div>
    <div>
      <label>VAT %</label>
      <select class="i_vat">
        <option value="0.21">21%</option>
        <option value="0.09">9%</option>
        <option value="0">0%</option>
      </select>
    </div>
    <div><button type="button" class="btn secondary" onclick="removeItemRow(${id})">✕</button></div>
  `;
  document.getElementById("itemsWrap").appendChild(row);
  row.querySelectorAll("input, select").forEach((el) => el.addEventListener("input", recalcTotals));
  recalcTotals();
}

function removeItemRow(id) {
  document.querySelector(`.items-row[data-id="${id}"]`)?.remove();
  recalcTotals();
}

function getItems() {
  return [...document.querySelectorAll(".items-row")].map((row) => ({
    description: row.querySelector(".i_desc").value,
    quantity: parseFloat(row.querySelector(".i_qty").value) || 0,
    unit_price: Math.round((parseFloat(row.querySelector(".i_price").value) || 0) * 100),
    vat_rate: parseFloat(row.querySelector(".i_vat").value),
  }));
}

function recalcTotals() {
  const vatScheme = document.getElementById("vat_scheme").value;
  const items = getItems();
  let subtotal = 0;
  let vat = 0;
  for (const it of items) {
    const lineTotal = Math.round(it.quantity * it.unit_price);
    subtotal += lineTotal;
    if (vatScheme === "standard") vat += Math.round(lineTotal * it.vat_rate);
  }
  document.getElementById("totalSubtotal").textContent = (subtotal / 100).toFixed(2);
  document.getElementById("totalVat").textContent = (vat / 100).toFixed(2);
  document.getElementById("totalGrand").textContent = ((subtotal + vat) / 100).toFixed(2);
}

async function init() {
  await requireLogin();
  if (!companyId) {
    document.body.innerHTML = "<p style='padding:24px'>No company selected. Go back to the dashboard.</p>";
    return;
  }

  const companiesData = await api("/api/companies");
  const company = companiesData.companies.find((c) => c.id === companyId);
  if (company) {
    document.getElementById("currency").value = company.default_currency;
    document.getElementById("vat_scheme").value = company.vat_scheme === "kor" ? "kor" : company.vat_scheme;
  }
  document.getElementById("invoice_date").value = new Date().toISOString().slice(0, 10);

  const clientsData = await api(`/api/clients?company_id=${companyId}`);
  const select = document.getElementById("client_id");
  select.innerHTML = clientsData.clients
    .map((cl) => `<option value="${cl.id}">${cl.name}</option>`)
    .join("");
  if (clientsData.clients.length === 0) {
    select.innerHTML = `<option value="">No clients — add one from the dashboard first</option>`;
  }

  document.getElementById("vat_scheme").addEventListener("change", recalcTotals);
  document.getElementById("numbering_mode").addEventListener("change", (e) => {
    document.getElementById("manualNumberWrap").style.display =
      e.target.value === "manual" ? "block" : "none";
  });
  document.getElementById("addItemBtn").addEventListener("click", () => addItemRow());
  addItemRow();

  document.getElementById("createBtn").addEventListener("click", async () => {
    const errorEl = document.getElementById("formError");
    errorEl.textContent = "";
    const clientId = document.getElementById("client_id").value;
    if (!clientId) { errorEl.textContent = "Select a client first."; return; }

    const body = {
      company_id: companyId,
      client_id: clientId,
      invoice_date: document.getElementById("invoice_date").value,
      delivery_date: document.getElementById("delivery_date").value,
      currency: document.getElementById("currency").value,
      vat_scheme: document.getElementById("vat_scheme").value,
      numbering_mode: document.getElementById("numbering_mode").value,
      manual_invoice_number: document.getElementById("manual_invoice_number").value || undefined,
      notes: document.getElementById("notes").value || undefined,
      items: getItems(),
    };

    try {
      const { invoice } = await api("/api/invoices", { method: "POST", body: JSON.stringify(body) });
      window.location.href = `/api/invoices/${invoice.id}/pdf`;
      setTimeout(() => (window.location.href = "dashboard.html"), 500);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

init();
