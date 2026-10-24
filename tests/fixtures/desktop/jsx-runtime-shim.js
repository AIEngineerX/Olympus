// react/jsx-runtime for the harness, on top of createElement. Like the real
// runtime, jsxs() passes a static children array (no keys needed) and jsx()
// passes a single child.
const React = window.React

function build(type, props, key, staticChildren) {
  const { children, ...rest } = props || {}
  const finalProps = key === undefined ? rest : { ...rest, key }
  if (children === undefined) return React.createElement(type, finalProps)
  return staticChildren ? React.createElement(type, finalProps, ...children) : React.createElement(type, finalProps, children)
}

export function jsx(type, props, key) {
  return build(type, props, key, false)
}

export function jsxs(type, props, key) {
  return build(type, props, key, true)
}
