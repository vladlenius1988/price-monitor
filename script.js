const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'products.json');

let products = [];

function loadProducts() {
  try {
    products = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    products = [];
  }
  renderProducts();
}

function saveProducts() {
  fs.writeFileSync(filePath, JSON.stringify(products, null, 2));
}

function renderProducts() {
  const ul = document.getElementById('product-list');
  ul.innerHTML = '';
  for (const p of products) {
    const li = document.createElement('li');
    li.textContent = `${p.name} — ${p.url} — ${p.price || 'Цена не загружена'}`;
    ul.appendChild(li);
  }
}

document.getElementById('add-product').addEventListener('click', () => {
  const name = document.getElementById('product-name').value;
  const url = document.getElementById('product-url').value;
  if (name && url) {
    products.push({ name, url });
    saveProducts();
    renderProducts();
  }
});

document.getElementById('update-prices').addEventListener('click', async () => {
  const updatedProducts = await ipcRenderer.invoke('update-prices');
  products = updatedProducts;
  renderProducts();
});

loadProducts();
