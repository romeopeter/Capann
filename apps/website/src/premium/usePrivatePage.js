import { useEffect } from 'react'

/**
 * For pages whose URL carries a token: keep them out of search results and stop
 * the URL leaking as a Referer. The SPA shares one index.html, so the tags are
 * set while the page is mounted and restored on the way out. (A referrer policy
 * set by a meta tag stays in force for the rest of the visit, which is fine.)
 */
export function usePrivatePage(title) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title
    const restore = [setMeta('referrer', 'no-referrer'), setMeta('robots', 'noindex, nofollow')]

    return () => {
      document.title = previousTitle
      restore.forEach((undo) => undo())
    }
  }, [title])
}

function setMeta(name, content) {
  let meta = document.head.querySelector(`meta[name="${name}"]`)
  const created = !meta
  const previous = meta?.getAttribute('content') ?? null

  if (created) {
    meta = document.createElement('meta')
    meta.setAttribute('name', name)
    document.head.prepend(meta)
  }
  meta.setAttribute('content', content)

  return () => {
    if (created) meta.remove()
    else meta.setAttribute('content', previous)
  }
}
