import { useState } from 'react'
import { t } from './i18n.js'
import { suggestRule } from '../../shared/permission-rule-patterns.mjs'

const decisions = [
  { value: 'task', label: '允许此任务', title: '允许此任务及后续操作，任务结束后失效' },
  { value: 'always', label: '始终允许', title: '本会话后续权限请求自动允许' },
  { value: 'reject', label: '拒绝', title: '拒绝当前操作' },
]

// `onRemember(rule)` saves a persistent rule (and allows the task); when the
// operation cannot be turned into a rule (destructive command, delete), the
// "Remember" button is not offered at all.
export default function PermissionActions({ authorization, onRespond, onRemember }) {
  const suggestion = typeof onRemember === 'function' ? suggestRule(authorization.operation) : null
  const [editing, setEditing] = useState(false)
  const [pattern, setPattern] = useState('')
  const [access, setAccess] = useState('read')
  const open = () => {
    setPattern(suggestion.pattern)
    setAccess(suggestion.access || 'read')
    setEditing(true)
  }
  const save = event => {
    event.preventDefault()
    if (!pattern.trim()) return
    onRemember({ type: suggestion.type, pattern: pattern.trim(), ...(suggestion.type === 'path' ? { access } : {}) })
    setEditing(false)
  }
  return <div className="permission-controls" aria-busy={Boolean(authorization.submitting)}>
    <div className={`permission-actions${suggestion ? ' with-remember' : ''}`} role="group" aria-label={t('权限决定')}>
      {decisions.map(({ value, label, title }) => <button
        key={value}
        type="button"
        className={`permission-${value}`}
        title={t(title)}
        aria-label={`${t(label)}：${t(title)}`}
        disabled={authorization.submitting}
        onClick={() => onRespond(value)}
      >{t(label)}</button>)}
      {suggestion && <button
        type="button"
        className="permission-remember"
        title={t('保存一条规则，以后匹配的操作不再询问')}
        aria-label={`${t('记住…')}：${t('保存一条规则，以后匹配的操作不再询问')}`}
        aria-expanded={editing}
        disabled={authorization.submitting}
        onClick={() => (editing ? setEditing(false) : open())}
      >{t('记住…')}</button>}
    </div>
    {editing && suggestion && <form className="permission-rule-editor" onSubmit={save}>
      <label>
        <span>{suggestion.type === 'command' ? t('始终允许命令') : t('始终允许文件夹')}</span>
        <input
          value={pattern}
          onChange={event => setPattern(event.target.value)}
          spellCheck={false}
          autoFocus
          aria-label={suggestion.type === 'command' ? t('命令模式') : t('文件夹路径')}
        />
      </label>
      {suggestion.type === 'path' && <label>
        <span>{t('访问')}</span>
        <select value={access} onChange={event => setAccess(event.target.value)}>
          <option value="read">{t('只读')}</option>
          <option value="write">{t('读写')}</option>
        </select>
      </label>}
      <small>{suggestion.type === 'command'
        ? t('* 匹配任意内容。删除类和危险命令始终会询问。')
        : t('该文件夹及其子文件夹。删除操作始终会询问。')}</small>
      <div className="permission-rule-editor-actions">
        <button type="submit" className="permission-task" disabled={!pattern.trim()}>{t('保存并允许')}</button>
        <button type="button" onClick={() => setEditing(false)}>{t('取消')}</button>
      </div>
    </form>}
    {authorization.submitting && <small role="status">{t('正在提交')}</small>}
    {authorization.error && <small className="permission-error" role="alert">
      {authorization.error}
    </small>}
  </div>
}
