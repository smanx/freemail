/**
 * 邮件 API 模块
 * @module api/emails
 */

import { getJwtPayload, errorResponse } from './helpers.js';
import { buildMockEmails, buildMockEmailDetail } from './mock.js';
import { extractEmail } from '../utils/common.js';
import { getMailboxIdByAddress } from '../db/index.js';
import { parseEmailBody } from '../email/parser.js';

/**
 * 处理邮件相关 API
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {URL} url - 请求 URL
 * @param {string} path - 请求路径
 * @param {object} options - 选项
 * @returns {Promise<Response|null>} 响应或 null（未匹配）
 */
export async function handleEmailsApi(request, db, url, path, options) {
  const isMock = !!options.mockOnly;
  const isMailboxOnly = !!options.mailboxOnly;
  const r2 = options.r2;

  // 获取邮件列表
  if (path === '/api/emails' && request.method === 'GET') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return errorResponse('缺少 mailbox 参数', 400);
    }
    try {
      if (isMock) {
        return Response.json(buildMockEmails(6));
      }
      const normalized = extractEmail(mailbox).trim().toLowerCase();
      const mailboxId = await getMailboxIdByAddress(db, normalized);
      if (!mailboxId) return Response.json([]);
      
      let timeFilter = '';
      let timeParam = [];
      if (isMailboxOnly) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        timeFilter = ' AND received_at >= ?';
        timeParam = [twentyFourHoursAgo];
      }
      
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
      
      try {
        const { results } = await db.prepare(`
          SELECT id, sender, subject, received_at, is_read, preview, verification_code
          FROM messages 
          WHERE mailbox_id = ?${timeFilter}
          ORDER BY received_at DESC 
          LIMIT ?
        `).bind(mailboxId, ...timeParam, limit).all();
        return Response.json(results);
      } catch (e) {
        const { results } = await db.prepare(`
          SELECT id, sender, subject, received_at, is_read,
                 CASE WHEN content IS NOT NULL AND content <> ''
                      THEN SUBSTR(content, 1, 120)
                      ELSE SUBSTR(COALESCE(html_content, ''), 1, 120)
                 END AS preview
          FROM messages 
          WHERE mailbox_id = ?${timeFilter}
          ORDER BY received_at DESC 
          LIMIT ?
        `).bind(mailboxId, ...timeParam, limit).all();
        return Response.json(results);
      }
    } catch (e) {
      console.error('查询邮件失败:', e);
      return errorResponse('查询邮件失败', 500);
    }
  }

  // 批量查询邮件详情
  if (path === '/api/emails/batch' && request.method === 'GET') {
    try {
      const idsParam = String(url.searchParams.get('ids') || '').trim();
      if (!idsParam) return Response.json([]);
      const ids = idsParam.split(',').map(s => parseInt(s, 10)).filter(n => Number.isInteger(n) && n > 0);
      if (!ids.length) return Response.json([]);
      
      if (ids.length > 50) {
        return errorResponse('单次最多查询50封邮件', 400);
      }
      
      if (isMock) {
        const arr = ids.map(id => buildMockEmailDetail(id));
        return Response.json(arr);
      }
      
      let timeFilter = '';
      let timeParam = [];
      if (isMailboxOnly) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        timeFilter = ' AND received_at >= ?';
        timeParam = [twentyFourHoursAgo];
      }

      const placeholders = ids.map(() => '?').join(',');
      try {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, verification_code, preview, eml_content, received_at, is_read
          FROM messages WHERE id IN (${placeholders})${timeFilter}
        `).bind(...ids, ...timeParam).all();

        // 为每封邮件解析内容
        const emailsWithContent = (results || []).map(row => {
          let content = '';
          let html_content = '';
          try {
            if (row.eml_content) {
              const parsed = parseEmailBody(row.eml_content || '');
              content = parsed.text || '';
              html_content = parsed.html || '';
            }
          } catch (e) {
            console.error('解析邮件内容失败:', e);
          }
          // 如果解析失败，使用 eml_content 作为文本内容
          if (!content && !html_content && row.eml_content) {
            content = row.eml_content;
          }
          // Fallback: 使用 preview 字段作为最后的内容来源（针对从 R2 迁移的旧邮件）
          if (!content && !html_content && row.preview) {
            content = row.preview;
          }
          return { ...row, content, html_content };
        });

        return Response.json(emailsWithContent);
      } catch (e) {
        // Fallback: 尝试从旧的 content/html_content 字段获取
        const { results } = await db.prepare(`
          SELECT id, sender, subject, content, html_content, received_at, is_read
          FROM messages WHERE id IN (${placeholders})${timeFilter}
        `).bind(...ids, ...timeParam).all();
        return Response.json(results || []);
      }
    } catch (e) {
      return errorResponse('批量查询失败', 500);
    }
  }

  // 清空邮箱邮件
  if (request.method === 'DELETE' && path === '/api/emails') {
    if (isMock) return errorResponse('演示模式不可清空', 403);
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return errorResponse('缺少 mailbox 参数', 400);
    }
    try {
      const normalized = extractEmail(mailbox).trim().toLowerCase();
      const mailboxId = await getMailboxIdByAddress(db, normalized);
      if (!mailboxId) {
        return Response.json({ success: true, deletedCount: 0 });
      }
      
      const result = await db.prepare(`DELETE FROM messages WHERE mailbox_id = ?`).bind(mailboxId).run();
      const deletedCount = result?.meta?.changes || 0;
      
      return Response.json({
        success: true,
        deletedCount
      });
    } catch (e) {
      console.error('清空邮件失败:', e);
      return errorResponse('清空邮件失败', 500);
    }
  }

  // 下载 EML（从数据库获取）- 必须在通用邮件详情处理器之前
  if (request.method === 'GET' && path.startsWith('/api/email/') && path.endsWith('/download')) {
    if (options.mockOnly) return errorResponse('演示模式不可下载', 403);
    const id = path.split('/')[3];
    const { results } = await db.prepare('SELECT subject, eml_content, received_at FROM messages WHERE id = ?').bind(id).all();
    const row = (results || [])[0];
    if (!row || !row.eml_content) return errorResponse('未找到邮件内容', 404);
    try {
      const headers = new Headers({ 'Content-Type': 'message/rfc822' });
      const filename = `${row.subject || 'email'}.eml`.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
      headers.set('Content-Disposition', `attachment; filename="${filename}"`);
      return new Response(row.eml_content, { headers });
    } catch (e) {
      return errorResponse('下载失败', 500);
    }
  }

  // 获取单封邮件详情
  if (request.method === 'GET' && path.startsWith('/api/email/')) {
    const emailId = path.split('/')[3];
    if (isMock) {
      return Response.json(buildMockEmailDetail(emailId));
    }
    try {
      let timeFilter = '';
      let timeParam = [];
      if (isMailboxOnly) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        timeFilter = ' AND received_at >= ?';
        timeParam = [twentyFourHoursAgo];
      }
      
      const { results } = await db.prepare(`
        SELECT id, sender, to_addrs, subject, verification_code, preview, eml_content, received_at, is_read
        FROM messages WHERE id = ?${timeFilter}
      `).bind(emailId, ...timeParam).all();
      if (results.length === 0) {
        if (isMailboxOnly) {
          return errorResponse('邮件不存在或已超过24小时访问期限', 404);
        }
        return errorResponse('未找到邮件', 404);
      }
      await db.prepare(`UPDATE messages SET is_read = 1 WHERE id = ?`).bind(emailId).run();
      const row = results[0];
      let content = '';
      let html_content = '';

      try {
        if (row.eml_content) {
          const parsed = parseEmailBody(row.eml_content || '');
          content = parsed.text || '';
          html_content = parsed.html || '';
        }
      } catch (e) {
        console.error('解析邮件内容失败:', e);
      }

      // 如果解析失败，尝试使用 eml_content 作为文本内容
      if (!content && !html_content && row.eml_content) {
        content = row.eml_content;
      }

      // Fallback 1: 尝试从旧的 content/html_content 字段获取（兼容性）
      if ((!content && !html_content)) {
        try {
          const fallback = await db.prepare('SELECT content, html_content FROM messages WHERE id = ?').bind(emailId).all();
          const fr = (fallback?.results || [])[0] || {};
          content = content || fr.content || '';
          html_content = html_content || fr.html_content || '';
        } catch (_) { }
      }

      // Fallback 2: 使用 preview 字段作为最后的内容来源（针对从 R2 迁移的旧邮件）
      if (!content && !html_content && row.preview) {
        content = row.preview;
      }

      return Response.json({ ...row, content, html_content, download: row.eml_content ? `/api/email/${emailId}/download` : '' });
    } catch (e) {
      const { results } = await db.prepare(`
        SELECT id, sender, subject, content, html_content, received_at, is_read
        FROM messages WHERE id = ?
      `).bind(emailId).all();
      if (!results || !results.length) return errorResponse('未找到邮件', 404);
      await db.prepare(`UPDATE messages SET is_read = 1 WHERE id = ?`).bind(emailId).run();
      return Response.json(results[0]);
    }
  }

  // 删除单封邮件
  if (request.method === 'DELETE' && path.startsWith('/api/email/')) {
    if (isMock) return errorResponse('演示模式不可删除', 403);
    const emailId = path.split('/')[3];
    
    if (!emailId || !Number.isInteger(parseInt(emailId))) {
      return errorResponse('无效的邮件ID', 400);
    }
    
    try {
      const result = await db.prepare(`DELETE FROM messages WHERE id = ?`).bind(emailId).run();
      const deleted = (result?.meta?.changes || 0) > 0;
      
      return Response.json({
        success: true,
        deleted,
        message: deleted ? '邮件已删除' : '邮件不存在或已被删除'
      });
    } catch (e) {
      console.error('删除邮件失败:', e);
      return errorResponse('删除邮件时发生错误: ' + e.message, 500);
    }
  }

  return null;
}
