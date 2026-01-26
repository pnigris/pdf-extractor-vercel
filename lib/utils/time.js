// lib/utils/time.js (CJS)
function formatSaoPauloDateTime(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  });
  return fmt.format(date);
}

module.exports = { formatSaoPauloDateTime };
