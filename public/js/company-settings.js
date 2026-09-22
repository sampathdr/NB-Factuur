const companyId = new URLSearchParams(window.location.search).get("id");
const fieldIds = [
  "legal_name", "trade_name", "address_line1", "postal_code", "city", "country",
  "kvk_number", "vat_number", "vat_scheme", "default_currency", "invoice_prefix",
  "iban", "email", "phone",
];

async function init() {
  await requireLogin();
  if (!companyId) {
    document.body.innerHTML = "<p style='padding:24px'>No company selected. Go back to the dashboard.</p>";
    return;
  }

  const data = await api("/api/companies");
  const company = data.companies.find((c) => c.id === companyId);
  if (!company) {
    document.body.innerHTML = "<p style='padding:24px'>Company not found.</p>";
    return;
  }

  for (const id of fieldIds) {
    const el = document.getElementById(id);
    if (el) el.value = company[id] ?? "";
  }

  if (company.logo_content_type) {
    const preview = document.getElementById("logoPreview");
    preview.src = `/api/companies/${companyId}/logo`;
    preview.style.display = "inline-block";
  }

  document.getElementById("logoInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const errorEl = document.getElementById("logoError");
    errorEl.textContent = "";
    try {
      const buf = await file.arrayBuffer();
      await api(`/api/companies/${companyId}/logo`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: buf,
      });
      const preview = document.getElementById("logoPreview");
      preview.src = `/api/companies/${companyId}/logo?ts=${Date.now()}`;
      preview.style.display = "inline-block";
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };

  document.getElementById("saveBtn").onclick = async () => {
    const errorEl = document.getElementById("saveError");
    errorEl.textContent = "";
    const payload = {};
    for (const id of fieldIds) {
      const el = document.getElementById(id);
      if (el) payload[id] = el.value || null;
    }
    try {
      await api(`/api/companies/${companyId}`, { method: "PUT", body: JSON.stringify(payload) });
      errorEl.textContent = "";
      errorEl.style.color = "green";
      errorEl.textContent = "Saved.";
    } catch (err) {
      errorEl.style.color = "";
      errorEl.textContent = err.message;
    }
  };
}

init();
