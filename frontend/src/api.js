async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || 'Något gick fel vid kontakt med servern.')
    error.status = response.status
    throw error
  }
  return response.status === 204 ? null : response.json()
}

async function fileRequest(path, options = {}) {
  const response = await fetch(path, options)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || 'Något gick fel vid kontakt med servern.')
    error.status = response.status
    throw error
  }
  return response.status === 204 ? null : response.json()
}

export const productApi = {
  active: () => request('/api/products'),
  all: () => request('/api/admin/products'),
  create: (product) => request('/api/products', { method: 'POST', body: JSON.stringify(product) }),
  update: (id, product) => request(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(product) }),
  delete: (id) => request(`/api/products/${id}`, { method: 'DELETE' }),
  setActive: (id, active) => request(`/api/products/${id}/active`, {
    method: 'PATCH', body: JSON.stringify({ active }),
  }),
}

export const settingsApi = {
  swish: () => request('/api/settings/swish'),
  setSwish: (selected) => request('/api/settings/swish', {
    method: 'PUT', body: JSON.stringify({ selected }),
  }),
  addSwishRecipient: (recipient) => request('/api/settings/swish/recipients', {
    method: 'POST', body: JSON.stringify(recipient),
  }),
  updateSwishRecipient: (id, recipient) => request(`/api/settings/swish/recipients/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify(recipient),
  }),
  deleteSwishRecipient: (id) => request(`/api/settings/swish/recipients/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
}

export const paymentApi = {
  swish: () => request('/api/payment/swish'),
}

export const authApi = {
  status: () => request('/api/auth/status'),
  login: (pin) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  setPin: (pin) => request('/api/local/admin-pin', { method: 'PUT', body: JSON.stringify({ pin }) }),
}

export const orderApi = {
  create: (order) => request('/api/orders', { method: 'POST', body: JSON.stringify(order) }),
}

export const statisticsApi = {
  today: () => request('/api/statistics/today'),
}

export const networkApi = {
  info: () => request('/api/network'),
}

export const logoApi = {
  status: () => request('/api/local/logo'),
  upload: (file) => fileRequest('/api/local/logo', {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }),
  remove: () => request('/api/local/logo', { method: 'DELETE' }),
}
