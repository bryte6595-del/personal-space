// Small helpers used everywhere: escaping text, links, page headings, toasts.
import { PAGE_SIZE, dom } from './state.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeHttpUrl(value) { if (value == null || String(value).trim() === '') return ''; try { const url = new URL(String(value).trim()); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 3500);
}
export function setBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = label || 'Please wait…'; }
  else { button.disabled = false; button.textContent = button.dataset.originalText || 'Submit'; }
}
export function initials(name = '?') { return name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?'; }
export function pageHead(title, desc = '', action = '') { return `<div class="page-head"><div><h2>${esc(title)}</h2>${desc ? `<p>${esc(desc)}</p>` : ''}</div>${action}</div>`; }
export function section(title, body) { return `<section class="section"><h3 class="section-title">${esc(title)}</h3>${body}</section>`; }
export function empty(message) { return `<p class="empty-state">${esc(message)}</p>`; }
export function profileLink(person, label = '') {
  const name = person?.display_name || 'Member';
  const username = person?.username || 'unknown';
  const avatarUrl = safeHttpUrl(person?.avatar_url);
  const avatar = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="">` : esc(initials(name));
  return `<button type="button" class="profile-link" data-open-profile="${esc(person?.id || '')}" aria-label="View ${esc(name)} profile"><span class="avatar mini">${avatar}</span><span class="profile-link-text"><strong>${esc(name)}</strong><small>@${esc(username)}${label ? ` · ${esc(label)}` : ''}</small></span></button>`;
}
export function field(label, name, value = '', type = 'text', extra = '') { return `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`; }
export function loadMoreMarkup(count) { return count >= PAGE_SIZE ? '<div class="load-more-wrap"><button class="button" type="button" data-load-more-posts>Load more posts</button></div>' : ''; }
export function entryBody(item) {
  const url = safeHttpUrl(item.url), gh = safeHttpUrl(item.github_url);
  const meta = [item.status, item.category, item.release_year, item.watched_on ? `Watched ${item.watched_on}` : '', item.rating != null ? `Rating ${item.rating}/10` : ''].filter(x => x !== '' && x != null).map(esc).join(' · ');
  const links = [url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open link</a>` : '', gh ? `<a href="${esc(gh)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : ''].filter(Boolean).join(' · ');
  const text = item.description || item.review || '';
  return `<strong>${esc(item.title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}${meta ? `<span class="post-meta">${meta}</span>` : ''}${links ? `<p>${links}</p>` : ''}${item.affiliate_disclosure ? `<p class="muted"><small>Disclosure: ${esc(item.affiliate_disclosure)}</small></p>` : ''}`;
}
export function blockedMessage(error, fallbackText) { return /row-level security|violates/i.test(error?.message || '') ? fallbackText : errorText(error); }
export function errorText(error) { return error?.message || 'Something went wrong. Please try again.'; }
export function isTypingInView() {
  const el = document.activeElement;
  return Boolean(el && dom.viewContainer.contains(el) && ['INPUT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'file' && String(el.value || '').trim());
}
export function openImageViewer(images, initialIndex = 0) {
  if (!images?.length) return;
  let index = Math.max(0, Math.min(initialIndex, images.length - 1));
  const modal = document.createElement('div');
  modal.className = 'image-viewer-backdrop';
  modal.innerHTML = `<div class="image-viewer" role="dialog" aria-modal="true" aria-label="Image viewer"><button type="button" class="image-viewer-close" aria-label="Close image">×</button><button type="button" class="image-viewer-prev" aria-label="Previous image" ${images.length < 2 ? 'hidden' : ''}>‹</button><img class="image-viewer-image" alt="Enlarged post image"><button type="button" class="image-viewer-next" aria-label="Next image" ${images.length < 2 ? 'hidden' : ''}>›</button><span class="image-viewer-count"></span></div>`;
  const img = modal.querySelector('img');
  const count = modal.querySelector('.image-viewer-count');
  const show = () => { img.src = images[index]; count.textContent = `${index + 1} / ${images.length}`; };
  const close = () => { modal.remove(); document.removeEventListener('keydown', keyHandler); };
  const prev = () => { index = (index - 1 + images.length) % images.length; show(); };
  const next = () => { index = (index + 1) % images.length; show(); };
  const keyHandler = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft' && images.length > 1) prev(); if (e.key === 'ArrowRight' && images.length > 1) next(); };
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.image-viewer-close')) close(); });
  modal.querySelector('.image-viewer-prev').addEventListener('click', prev);
  modal.querySelector('.image-viewer-next').addEventListener('click', next);
  document.addEventListener('keydown', keyHandler);
  document.body.append(modal); show();
}
