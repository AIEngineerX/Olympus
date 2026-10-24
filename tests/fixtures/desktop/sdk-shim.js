// Stand-in for Hermes Desktop's @hermes/plugin-sdk in the browser harness:
// the exports desktop/plugin.js uses, with host actions recorded for asserts.
const React = window.React

export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'

export function Button({ variant, size, ...props }) {
  return React.createElement('button', { type: 'button', 'data-variant': variant, 'data-size': size, ...props })
}

export function Badge({ variant, ...props }) {
  return React.createElement('span', { 'data-badge': variant, ...props })
}

export const host = {
  openSession: (id, options) => {
    window.__DESKTOP_OPENED__ = { id, options }
    return Promise.resolve()
  }
}
