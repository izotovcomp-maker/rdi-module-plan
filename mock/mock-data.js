/* Вымышленные данные макета «График модулей» (задача M1).
   Подключается тегом <script> (не fetch) — иначе файл не откроется двойным кликом.
   Структура повторяет будущий ответ api/graph.php на одну сделку:
   { stages: [{id, title, dfinish}], modules: [{id, title, num, sname, stageId,
     parentStageId, check, create, dayRun, dayEdit, dayWait, dayApprove}] }
   stages — этапы сделки (смарт-процесс Milestone 1042): группы, в которые вложены
   модули; dfinish — дата завершения этапа по КП (справочная). Модуль привязан к
   этапу через parentStageId; check/create/day* — стадии самого модуля.
   Название модуля по БП: {Название этапа}_{Номер}-{Краткое наименование}.
   Даты YYYY-MM-DD, длительности — числа дней (пустая строка = не спланировано).
   Все названия и цифры придуманы, к реальному порталу отношения не имеют. */
const MOCK_DATA = {
  deals: [
    {
      id: '3051',
      title: 'ЖК «Северный», корпус 2 — рабочая документация',
      stages: [
        { id: 'E1', title: '0001-1-Подготовительная документация', dfinish: '2026-09-30' },
        { id: 'E2', title: '0001-2-Архитектурные решения',         dfinish: '2026-11-15' },
        { id: 'E3', title: '0001-3-Конструктивные решения',        dfinish: '2026-12-20' },
        { id: 'E4', title: '0001-4-Инженерные системы',            dfinish: '2027-01-25' }
      ],
      modules: [
        { id: '8001', title: '0001-1-Подготовительная документация_1-ИИ_01-Подготовка',            num: '1', sname: 'ИИ_01',   stageId: 'E1', parentStageId: 'E1', check: '2026-09-07', create: '2026-09-14', dayRun: 5,  dayEdit: 3,  dayWait: 1, dayApprove: 4 },
        { id: '8002', title: '0001-1-Подготовительная документация_2-ГП_01-Генеральный план',       num: '2', sname: 'ГП_01',   stageId: 'E1', parentStageId: 'E1', check: '2026-09-16', create: '2026-10-05', dayRun: 12, dayEdit: 6,  dayWait: 2, dayApprove: 5 },
        { id: '8003', title: '0001-2-Архитектурные решения_3-АР_01-Объемно-планировочные решения',  num: '3', sname: 'АР_01',   stageId: 'E2', parentStageId: 'E2', check: '2026-09-28', create: '2026-10-26', dayRun: 18, dayEdit: 8,  dayWait: 3, dayApprove: 6 },
        { id: '8004', title: '0001-2-Архитектурные решения_4-АР_02-Фасады',                         num: '4', sname: 'АР_02',   stageId: 'E2', parentStageId: 'E2', check: '',           create: '',           dayRun: 0,  dayEdit: 0,  dayWait: 0, dayApprove: 0 },
        { id: '8005', title: '0001-3-Конструктивные решения_5-КР_01-Фундаменты',                    num: '5', sname: 'КР_01',   stageId: 'E3', parentStageId: 'E3', check: '2026-10-19', create: '2026-11-09', dayRun: 10, dayEdit: 5,  dayWait: 2, dayApprove: 7 },
        { id: '8006', title: '0001-3-Конструктивные решения_6-КР_02-Каркас',                        num: '6', sname: 'КР_02',   stageId: 'E3', parentStageId: 'E3', check: '2026-11-02', create: '2026-11-02', dayRun: 0,  dayEdit: 0,  dayWait: 0, dayApprove: 0 },
        { id: '8007', title: '0001-4-Инженерные системы_7-ОВ_03-Вентиляция',                        num: '7', sname: 'ОВ_03',   stageId: 'E4', parentStageId: 'E4', check: '2026-11-16', create: '2026-12-14', dayRun: 15, dayEdit: 7,  dayWait: 4, dayApprove: 8 },
        { id: '8008', title: '0001-4-Инженерные системы_8-СС_07-Слаботочные системы и структурированная кабельная сеть административно-бытового корпуса', num: '8', sname: 'СС_07', stageId: 'E4', parentStageId: 'E4', check: '2026-11-30', create: '2027-01-11', dayRun: 20, dayEdit: 9, dayWait: 2, dayApprove: 10 }
      ]
    },
    {
      id: '3088',
      title: 'Административное здание НПО «Прогресс» — стадия П',
      stages: [
        { id: 'E1', title: '0002-1-Подготовительная документация', dfinish: '2026-10-15' },
        { id: 'E2', title: '0002-2-Архитектурно-строительные решения', dfinish: '2026-12-10' },
        { id: 'E3', title: '0002-3-Сметная документация', dfinish: '2027-01-30' }
      ],
      modules: [
        { id: '8101', title: '0002-1-Подготовительная документация_1-ИИ_01-Подготовка',   num: '1', sname: 'ИИ_01',   stageId: 'E1', parentStageId: 'E1', check: '2026-09-21', create: '2026-09-21', dayRun: 0,  dayEdit: 0,  dayWait: 0, dayApprove: 0 },
        { id: '8102', title: '0002-1-Подготовительная документация_2-ПЗУ_01-Пояснительная записка', num: '2', sname: 'ПЗУ_01', stageId: 'E1', parentStageId: 'E1', check: '2026-10-05', create: '2026-10-26', dayRun: 14, dayEdit: 7, dayWait: 1, dayApprove: 5 },
        { id: '8103', title: '0002-2-Архитектурно-строительные решения_3-АС_01-Архитектурные решения', num: '3', sname: 'АС_01', stageId: 'E2', parentStageId: 'E2', check: '2026-10-19', create: '2026-11-16', dayRun: 21, dayEdit: 10, dayWait: 3, dayApprove: 7 },
        { id: '8104', title: '0002-2-Архитектурно-строительные решения_4-ОВиК_01-Отопление', num: '4', sname: 'ОВиК_01', stageId: 'E2', parentStageId: 'E2', check: '', create: '', dayRun: 0, dayEdit: 0, dayWait: 0, dayApprove: 0 },
        { id: '8105', title: '0002-2-Архитектурно-строительные решения_5-ЭОМ_02-Освещение', num: '5', sname: 'ЭОМ_02', stageId: 'E2', parentStageId: 'E2', check: '2026-11-23', create: '2026-11-23', dayRun: 0, dayEdit: 0, dayWait: 0, dayApprove: 0 },
        { id: '8106', title: '0002-3-Сметная документация_6-ГСВ_01-Свод сметных расчетов административно-бытового корпуса с пристройкой', num: '6', sname: 'ГСВ_01', stageId: 'E3', parentStageId: 'E3', check: '2026-12-07', create: '2027-01-18', dayRun: 25, dayEdit: 12, dayWait: 5, dayApprove: 9 },
        { id: '8107', title: '0002-3-Сметная документация_7-ГСВ_02-Свод бюджетов',        num: '7', sname: 'ГСВ_02',  stageId: 'E3', parentStageId: 'E3', check: '2026-12-21', create: '2027-01-25', dayRun: 8,  dayEdit: 4,  dayWait: 2, dayApprove: 6 }
      ]
    }
  ]
};

/* Экспорт для браузера (index.html) и для node-проверок. */
if (typeof window !== 'undefined') { window.MOCK_DATA = MOCK_DATA; }
if (typeof module !== 'undefined' && module.exports) { module.exports = MOCK_DATA; }
