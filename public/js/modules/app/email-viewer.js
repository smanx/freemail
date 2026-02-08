/**
 * 邮件查看模块
 * @module modules/app/email-viewer
 */

import { escapeHtml, escapeAttr, extractCode } from './ui-helpers.js';
import { getEmailFromCache, setEmailCache } from './email-list.js';

/**
 * 显示邮件详情
 * @param {number} id - 邮件ID
 * @param {object} elements - DOM 元素
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 */
export async function showEmailDetail(id, elements, api, showToast) {
  const { modal, modalSubject, modalContent } = elements;

  try {
    let email = getEmailFromCache(id);
    if (!email || (!email.html_content && !email.content)) {
      const r = await api(`/api/email/${id}`);
      email = await r.json();
      setEmailCache(id, email);
    }

    modalSubject.innerHTML = `<span class="modal-icon">📧</span><span>${escapeHtml(email.subject || '(无主题)')}</span>`;

    let contentHtml = '';

    // 实时提取验证码：优先使用后端保存的，否则从邮件内容中提取
    const dbCode = email.verification_code;
    const extractedCode = extractCode(email.content || email.html_content || '');
    const code = dbCode || extractedCode;

    // 调试日志
    console.log('[showEmailDetail] 邮件ID:', id);
    console.log('[showEmailDetail] 数据库验证码:', dbCode);
    console.log('[showEmailDetail] 实时提取验证码:', extractedCode);
    console.log('[showEmailDetail] 最终验证码:', code);
    console.log('[showEmailDetail] 邮件内容长度:', (email.content || email.html_content || '').length);

    // 定义显示提示的辅助函数
    const showNotice = (msg, type) => {
      console.log(`[showNotice] ${type}: ${msg}`);
      if (typeof showToast === 'function') {
        showToast(msg, type);
      } else if (typeof window.showToast === 'function') {
        window.showToast(msg, type);
      } else {
        alert(`[${type}] ${msg}`);
      }
    };

    // 定义复制函数，支持 fallback
    const copyToClipboard = async (text) => {
      console.log('[copyToClipboard] 尝试复制:', text);

      // 方法 1: 使用 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          console.log('[copyToClipboard] Clipboard API 成功');
          return true;
        } catch (err) {
          console.warn('[copyToClipboard] Clipboard API 失败:', err);
        }
      }

      // 方法 2: 使用 document.execCommand (fallback)
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
          console.log('[copyToClipboard] execCommand 成功');
          return true;
        } else {
          console.warn('[copyToClipboard] execCommand 失败');
        }
      } catch (err) {
        console.error('[copyToClipboard] execCommand 异常:', err);
      }

      // 方法 3: 提示用户手动复制
      console.warn('[copyToClipboard] 所有方法都失败');
      showNotice('自动复制失败，请手动选择文本复制', 'error');
      return false;
    };

    if (code) {
      console.log('[showEmailDetail] 显示验证码框:', code);
      contentHtml += `
        <div class="verification-code-box" style="margin-bottom:16px;padding:12px;background:var(--success-light);border-radius:8px;display:flex;align-items:center;gap:12px">
          <span style="font-size:20px">🔑</span>
          <span class="verification-code-text" data-code="${escapeAttr(code)}" style="font-size:18px;font-weight:600;font-family:monospace;cursor:pointer" title="点击复制验证码">${escapeHtml(code)}</span>
          <span style="font-size:12px;color:var(--text-muted)">点击复制</span>
        </div>`;
    } else {
      console.log('[showEmailDetail] 未提取到验证码');
    }

    if (email.html_content) {
      contentHtml += `<iframe class="email-frame" srcdoc="${escapeAttr(email.html_content)}" style="width:100%;min-height:400px;border:none"></iframe>`;
    } else {
      contentHtml += `<pre style="white-space:pre-wrap;word-break:break-word">${escapeHtml(email.content || '')}</pre>`;
    }

    modalContent.innerHTML = contentHtml;
    modal.classList.add('show');

    // 添加验证码复制事件监听器
    const codeElement = modalContent.querySelector('.verification-code-text');
    console.log('[showEmailDetail] codeElement:', codeElement);

    if (codeElement) {
      // 移除可能存在的旧监听器
      const newCodeElement = codeElement.cloneNode(true);
      codeElement.parentNode.replaceChild(newCodeElement, codeElement);

      newCodeElement.addEventListener('click', async (e) => {
        console.log('[verification-code-click] 点击事件触发');
        e.preventDefault();
        e.stopPropagation();

        const codeToCopy = newCodeElement.dataset.code;
        console.log('[verification-code-click] data-code:', codeToCopy);

        if (!codeToCopy) {
          showNotice('验证码为空，无法复制', 'error');
          return;
        }

        const success = await copyToClipboard(codeToCopy);
        if (success) {
          showNotice('验证码已复制', 'success');
        }
      });

      // 添加视觉反馈
      newCodeElement.addEventListener('mouseenter', () => {
        newCodeElement.style.opacity = '0.7';
      });
      newCodeElement.addEventListener('mouseleave', () => {
        newCodeElement.style.opacity = '1';
      });

      console.log('[showEmailDetail] 事件监听器已添加');
    } else {
      console.warn('[showEmailDetail] 未找到验证码元素');
    }
  } catch(e) {
    console.error('加载邮件详情失败:', e);
    const showNotice = (msg, type) => {
      console.log(`[showNotice] ${type}: ${msg}`);
      if (typeof showToast === 'function') {
        showToast(msg, type);
      } else if (typeof window.showToast === 'function') {
        window.showToast(msg, type);
      } else {
        alert(`[${type}] ${msg}`);
      }
    };
    showNotice(e.message || '加载失败', 'error');
  }
}

/**
 * 删除邮件
 * @param {number} id - 邮件ID
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} showConfirm - 确认函数
 * @param {Function} refresh - 刷新函数
 */
export async function deleteEmailById(id, api, showToast, showConfirm, refresh) {
  const confirmed = await showConfirm('确定删除这封邮件？');
  if (!confirmed) return;
  
  try {
    const r = await api(`/api/email/${id}`, { method: 'DELETE' });
    if (r.ok) {
      showToast('邮件已删除', 'success');
      await refresh();
    }
  } catch(e) {
    showToast(e.message || '删除失败', 'error');
  }
}

/**
 * 删除已发送邮件
 * @param {number} id - 邮件ID
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} showConfirm - 确认函数
 * @param {Function} refresh - 刷新函数
 */
export async function deleteSentById(id, api, showToast, showConfirm, refresh) {
  const confirmed = await showConfirm('确定删除这条发送记录？');
  if (!confirmed) return;
  
  try {
    const r = await api(`/api/sent/${id}`, { method: 'DELETE' });
    if (r.ok) {
      showToast('记录已删除', 'success');
      await refresh();
    }
  } catch(e) {
    showToast(e.message || '删除失败', 'error');
  }
}

/**
 * 从列表复制验证码或内容
 * @param {Event} event - 事件
 * @param {number} id - 邮件ID
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 */
export async function copyFromEmailList(event, id, api, showToast) {
  const btn = event.target.closest('button');
  const code = btn?.dataset?.code;
  
  if (code) {
    try {
      await navigator.clipboard.writeText(code);
      showToast(`验证码 ${code} 已复制`, 'success');
    } catch(_) {
      showToast('复制失败', 'error');
    }
  } else {
    let email = getEmailFromCache(id);
    if (!email) {
      const r = await api(`/api/email/${id}`);
      email = await r.json();
      setEmailCache(id, email);
    }
    const text = email.content || email.html_content?.replace(/<[^>]+>/g, ' ') || '';
    try {
      await navigator.clipboard.writeText(text.slice(0, 500));
      showToast('内容已复制', 'success');
    } catch(_) {
      showToast('复制失败', 'error');
    }
  }
}

/**
 * 预取邮件详情
 * @param {Array} emails - 邮件列表
 * @param {Function} api - API 函数
 */
export async function prefetchEmails(emails, api) {
  const top = emails.slice(0, 5);
  for (const e of top) {
    if (!getEmailFromCache(e.id)) {
      try {
        const r = await api(`/api/email/${e.id}`);
        const detail = await r.json();
        setEmailCache(e.id, detail);
      } catch(_) {}
    }
  }
}

export default {
  showEmailDetail,
  deleteEmailById,
  deleteSentById,
  copyFromEmailList,
  prefetchEmails
};
