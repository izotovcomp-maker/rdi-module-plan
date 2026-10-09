/* Вымышленные данные макета. Подключается тегом <script> (не fetch) — иначе файл
   не откроется двойным кликом. Меняйте под проект: правдоподобные названия, суммы, даты,
   статусы, а также пустые и длинные значения. Реальных данных клиента здесь быть не должно. */
const STATUSES = [
  { code: 'NEW',  name: 'Новая',     color: '#f36509' },
  { code: 'WORK', name: 'В работе',  color: '#fff300' },
  { code: 'DONE', name: 'Завершена', color: '#00ff00' }
];
const SEED = [
  { id: 1, title: 'Пример записи 1', date: '2026-10-05', amount: 120000, status: 'NEW' },
  { id: 2, title: 'Пример записи 2', date: '2026-10-12', amount: 85000,  status: 'WORK' },
  { id: 3, title: 'Пример записи 3', date: '2026-10-20', amount: -40000, status: 'DONE' }
];

/* Пример текста в окне «Дебаг» (в приложении там результат api/probe-task.php). */
const DEBUG_SAMPLE = JSON.stringify({
  note: 'Пример. В приложении здесь будет ответ портала',
  user: { ID: '1', NAME: 'Иван', LAST_NAME: 'Петров' },
  fields: { UF_CRM_8_O_CODE: { type: 'string', title: 'Код объекта' } }
}, null, 2);
