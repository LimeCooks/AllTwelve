const byId = (id) => document.getElementById(id);
let state = null,
  busy = false;
const showError = (error) => {
  byId('error').textContent =
    error instanceof Error
      ? error.message
      : 'Recovery could not be confirmed. Refresh status before continuing.';
  byId('error').hidden = false;
};
const notice = (text) => {
  byId('status').textContent = text;
};
const lock = (value) => {
  busy = value;
  for (const control of document.querySelectorAll('button,input'))
    control.disabled = value;
  updateFinish();
};
function updateFinish() {
  byId('finish').disabled =
    busy ||
    state?.state !== 'preparing' ||
    !state.files.every((file) => file.verified) ||
    !byId('understand').checked;
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error ||
        'Recovery could not be confirmed. Refresh status before continuing.',
    );
  return result;
}
async function uploadFile(file, selected) {
  const headers = { 'x-recovery-digest': state.digest };
  const path = '?key=' + encodeURIComponent(file.key);
  if (file.size <= 8 * 1024 * 1024) {
    await api('/recovery/file' + path, {
      method: 'PUT',
      headers: { ...headers, 'x-recovery-size': String(file.size) },
      body: selected,
    });
    return;
  }
  const progress = await api('/recovery/chunks' + path, { headers });
  const chunkBytes = 8 * 1024 * 1024,
    total = Math.ceil(file.size / chunkBytes);
  if (
    progress.chunkBytes !== chunkBytes ||
    progress.total !== total ||
    !Array.isArray(progress.chunks) ||
    progress.chunks.length > total
  )
    throw new Error(
      'Chunk progress was incomplete. Refresh status before continuing.',
    );
  for (let index = 0; index < total; index++) {
    const chunk = selected.slice(
      index * chunkBytes,
      Math.min(file.size, (index + 1) * chunkBytes),
    );
    const hash = await crypto.subtle.digest(
      'SHA-256',
      await chunk.arrayBuffer(),
    );
    const sha256 = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const saved = progress.chunks.find((part) => part.index === index);
    notice(
      `Verifying ${file.originalName || file.key}: chunk ${index + 1} of ${total}…`,
    );
    if (saved?.sha256 === sha256 && saved.size === chunk.size) continue;
    await api('/recovery/chunk' + path + '&index=' + index, {
      method: 'PUT',
      headers: {
        ...headers,
        'x-recovery-size': String(chunk.size),
        'x-recovery-sha256': sha256,
      },
      body: chunk,
    });
  }
  notice(`Checking the complete ${file.originalName || file.key} file…`);
  await api('/recovery/file' + path, { method: 'POST', headers });
}
function render(value) {
  if (
    !value ||
    !['empty', 'preparing', 'complete'].includes(value.state) ||
    (value.state !== 'empty' &&
      (!Array.isArray(value.files) || typeof value.digest !== 'string'))
  )
    throw new Error(
      'Recovery status was incomplete. Refresh before continuing.',
    );
  state = value;
  byId('understand').checked = false;
  byId('choose').hidden = value.state !== 'empty';
  byId('prepared').hidden = value.state === 'empty';
  if (value.state === 'empty') {
    notice('This recovery destination is empty.');
    return;
  }
  byId('team').textContent = value.teamName;
  byId('totals').textContent =
    `${value.records} records · ${value.files.filter((file) => file.verified).length} of ${value.files.length} files verified`;
  byId('complete').hidden = value.state !== 'complete';
  byId('confirm').hidden = value.state === 'complete';
  const files = byId('files');
  files.replaceChildren();
  for (const file of value.files) {
    const row = document.createElement('div');
    row.className = 'file';
    const title = document.createElement('strong');
    title.textContent = file.originalName || file.key;
    row.append(title);
    const detail = document.createElement('small');
    detail.textContent = `${file.key} · ${file.size.toLocaleString()} bytes`;
    row.append(detail);
    if (file.verified) {
      const status = document.createElement('p');
      status.className = 'verified';
      status.textContent = 'Verified';
      row.append(status);
    } else {
      const label = document.createElement('label');
      label.textContent = `Choose and upload ${file.originalName || file.key}`;
      const input = document.createElement('input');
      input.type = 'file';
      input.setAttribute('aria-label', label.textContent);
      label.append(input);
      row.append(label);
      input.addEventListener('change', async () => {
        if (busy || !input.files?.[0]) return;
        const selected = input.files[0];
        if (selected.size !== file.size) {
          showError(
            new Error(
              'This file has a different size. Choose the matching original recovered file.',
            ),
          );
          input.value = '';
          return;
        }
        lock(true);
        byId('error').hidden = true;
        notice(`Uploading and verifying ${file.originalName || file.key}…`);
        try {
          await uploadFile(file, selected);
          render(await api('/recovery/status'));
        } catch (error) {
          showError(error);
          notice(
            'Upload not confirmed. Refresh status or choose the same file again to retry.',
          );
          input.value = '';
        } finally {
          lock(false);
        }
      });
    }
    files.append(row);
  }
  notice(
    value.state === 'complete'
      ? 'Recovery verified in this separate workspace.'
      : 'Preparation saved. Upload every file before restoring records.',
  );
  updateFinish();
}
async function refresh() {
  if (busy) return;
  lock(true);
  byId('error').hidden = true;
  try {
    render(await api('/recovery/status'));
  } catch (error) {
    byId('choose').hidden = true;
    byId('prepared').hidden = true;
    state = null;
    showError(error);
    notice('Recovery status is unavailable. No records were replaced.');
  } finally {
    lock(false);
  }
}
byId('refresh').addEventListener('click', refresh);
byId('understand').addEventListener('change', updateFinish);
byId('manifest').addEventListener('change', async (event) => {
  if (busy || !event.target.files?.[0]) return;
  const file = event.target.files[0];
  if (file.size > 18 * 1024 * 1024) {
    showError(
      new Error('This manifest exceeds the supported structured size.'),
    );
    return;
  }
  lock(true);
  byId('error').hidden = true;
  notice('Validating the prepared backup…');
  try {
    render(
      await api('/recovery/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: file,
      }),
    );
  } catch (error) {
    showError(error);
    notice('Preparation was not confirmed. Refresh status before retrying.');
    event.target.value = '';
  } finally {
    lock(false);
  }
});
byId('finish').addEventListener('click', async () => {
  if (byId('finish').disabled || busy) return;
  lock(true);
  byId('error').hidden = true;
  notice('Restoring and verifying team records…');
  try {
    render(
      await api('/recovery/commit', {
        method: 'POST',
        headers: { 'x-recovery-digest': state.digest },
      }),
    );
  } catch (error) {
    showError(error);
    state = null;
    byId('understand').checked = false;
    notice(
      'Recovery confirmation was interrupted. Refresh status to check the saved result before retrying.',
    );
  } finally {
    lock(false);
  }
});
window.addEventListener('beforeunload', (event) => {
  if (busy) event.preventDefault();
});
refresh();

// Foreground browser-agent support shares the visible upload flow. It creates
// no background connection, service credential, alternate identity or API.
if (typeof document.modelContext?.registerTool === 'function') {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  const register = (tool) => {
    try {
      Promise.resolve(
        document.modelContext.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Ordinary file selection remains available without agent support. */
    }
  };
  register({
    name: 'read_recovery_status',
    description:
      'Refresh the signed-in owner’s separate recovery workspace and return its verified file progress.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length
      )
        throw new Error('No input fields are needed.');
      if (busy)
        throw new Error('An upload or recovery check is already running.');
      lock(true);
      try {
        const result = await api('/recovery/status');
        render(result);
        return result;
      } finally {
        lock(false);
      }
    },
  });
  register({
    name: 'upload_prepared_recovery_file',
    description:
      'Upload one file of at most 8 MiB from the already prepared backup in this foreground recovery page. The existing server verifies its exact size and SHA-256; this action does not restore team records.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', maxLength: 160 },
        base64: { type: 'string', maxLength: 11184812 },
      },
      required: ['key', 'base64'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    async execute(input) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).sort().join(',') !== 'base64,key' ||
        typeof input.key !== 'string' ||
        input.key.length > 160 ||
        typeof input.base64 !== 'string' ||
        input.base64.length > 11184812 ||
        input.base64.length % 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          input.base64,
        )
      )
        throw new Error('Provide a prepared file key and valid base64 bytes.');
      if (busy)
        throw new Error('An upload or recovery check is already running.');
      const bytes = Uint8Array.from(atob(input.base64), (character) =>
        character.charCodeAt(0),
      );
      if (bytes.length > 8 * 1024 * 1024)
        throw new Error('Use the resumable file picker for larger files.');
      lock(true);
      byId('error').hidden = true;
      try {
        const current = await api('/recovery/status');
        render(current);
        if (current.state !== 'preparing')
          throw new Error(
            'Prepare the recovery backup before uploading files.',
          );
        const file = current.files.find((file) => file.key === input.key);
        if (!file || file.size !== bytes.length)
          throw new Error('These bytes do not match a prepared file size.');
        if (!file.verified)
          await uploadFile(
            file,
            new File([bytes], file.originalName || file.key),
          );
        const result = await api('/recovery/status');
        render(result);
        return {
          key: file.key,
          verified:
            result.files.find((entry) => entry.key === file.key)?.verified ===
            true,
          state: result.state,
        };
      } catch (error) {
        showError(error);
        throw error;
      } finally {
        lock(false);
      }
    },
  });
}
