window.UC_PACKAGES=window.UC_PACKAGES||{};
/* Справочник 6 пакетов УЦ. Источник полей — «Справочник плейсхолдеров УЦ.xlsx»
   (колонки Плейсхолдер|Категория|Описание|Источник|Пример).
   ВСЕ образцы (sample) ОБЕЗЛИЧЕНЫ: фейковые ФИО («Иванов Иван Иванович»),
   фейковые ИНН/ОГРН/номера, демо-организация. Реальных персданных нет.
   Структура: window.UC_PACKAGES[pkgId] = {
     name,                                  // как в справочнике (ПАКЕТ N: …)
     fields: [{ token, label, source, sample }],  // token без фигурных скобок
     docs: [заголовки документов пакета]
   }
   Токены и source совпадают с window.SEED.placeholders (контракт сохранён). */
Object.assign(window.UC_PACKAGES, {

  /* ===== ПАКЕТ 1: АККРЕДИТАЦИЯ ===== */
  accreditation: {
    name: 'ПАКЕТ 1: АККРЕДИТАЦИЯ',
    fields: [
      { token:'EXPERT_ORG_FULL_NAME',     label:'Экспертная организация — полное наименование', source:'ЕГРЮЛ',       sample:'Общество с ограниченной ответственностью «ДЕМО ГРУПП»' },
      { token:'EXPERT_ORG_SHORT_NAME',    label:'Экспертная организация — краткое наименование',  source:'ЕГРЮЛ',       sample:'ООО «ДЕМО ГРУПП»' },
      { token:'EXPERT_ORG_INN',           label:'ИНН организации',                                source:'ЕГРЮЛ',       sample:'7701234567' },
      { token:'EXPERT_ORG_OGRN',          label:'ОГРН организации',                               source:'ЕГРЮЛ',       sample:'1027700123456' },
      { token:'EXPERT_ORG_ADDRESS',       label:'Юридический адрес',                              source:'ЕГРЮЛ',       sample:'000000, г. Москва, ул. Примерная, д. 1, помещение I, оф. 1' },
      { token:'EXPERT_FULL_NAME',         label:'ФИО эксперта полностью',                         source:'Диплом',      sample:'Иванов Иван Иванович' },
      { token:'EXPERT_FULL_NAME_GENITIVE',label:'ФИО эксперта (дат. падеж — кому выдано)',         source:'Диплом',      sample:'Иванову Ивану Ивановичу' },
      { token:'CERTIFICATE_NUMBER',       label:'Номер свидетельства организации',                source:'Яндекс-форма',sample:'00/ЭО/00-ПБ' },
      { token:'CERTIFICATE_DATE',         label:'Дата выдачи свидетельства',                      source:'Яндекс-форма',sample:'«01» января 2025' },
      { token:'ATTESTAT_NUMBER',          label:'Номер аттестата эксперта',                       source:'Яндекс-форма',sample:'000/АЭ/00-ПБ' },
      { token:'ATTESTAT_DATE',            label:'Дата выдачи аттестата',                          source:'Яндекс-форма',sample:'«01» января 2025' }
    ],
    docs: [
      'Свидетельство об аккредитации экспертной организации',
      'Аттестат эксперта',
      'Приложение к свидетельству об аккредитации'
    ]
  },

  /* ===== ПАКЕТ 2: ИСО ===== */
  iso: {
    name: 'ПАКЕТ 2: ИСО',
    fields: [
      { token:'ISO_ORG_FULL_NAME',  label:'Организация — полное наименование', source:'ЕГРЮЛ',       sample:'Общество с ограниченной ответственностью «ДЕМО ГРУПП»' },
      { token:'ISO_ORG_INN',        label:'ИНН организации',                   source:'ЕГРЮЛ',       sample:'7701234567' },
      { token:'ISO_ORG_ADDRESS',    label:'Юридический адрес',                 source:'ЕГРЮЛ',       sample:'000000, г. Москва, ул. Примерная, д. 1, помещение I, оф. 1' },
      { token:'ISO_OKVED_CODES',    label:'Коды ОКВЭД организации',            source:'ЕГРЮЛ',       sample:'93.1 Деятельность в области спорта;\n93.19 Деятельность в области спорта прочая.' },
      { token:'ISO_EXPERT_FULL_NAME',label:'ФИО эксперта полностью',           source:'Диплом',      sample:'Иванов Иван Иванович' },
      { token:'ISO_STANDARDS',      label:'Выбранные стандарты ИСО',           source:'Яндекс-форма',sample:'ГОСТ Р ИСО 9001-2015 (ISO 9001:2015)' },
      { token:'ISO_CERT_REG_NUMBER',label:'Регистрационный номер сертификата', source:'Яндекс-форма',sample:'00/00-ISO' },
      { token:'ISO_CERT_START_DATE',label:'Дата начала действия',             source:'Яндекс-форма',sample:'01.01.2025' },
      { token:'ISO_CERT_END_DATE',  label:'Дата окончания действия',          source:'Яндекс-форма',sample:'01.01.2028' },
      { token:'ISO_PROTOCOL_NUMBER',label:'Номер протокола комиссии',          source:'Яндекс-форма',sample:'00/00' }
    ],
    docs: [
      'Сертификат соответствия системы менеджмента ИСО',
      'Приложение к сертификату ИСО',
      'Протокол заседания комиссии'
    ]
  },

  /* ===== ПАКЕТ 3: Профка ПБ ===== */
  prof_pb: {
    name: 'ПАКЕТ 3: Профка ПБ',
    fields: [
      { token:'PROF_STUDENT_FULL_NAME',      label:'ФИО обучающегося полностью',                 source:'СНИЛС',       sample:'Иванов Иван Иванович' },
      { token:'PROF_STUDENT_NAME_GENITIVE',  label:'ФИО (дат. падеж — кому выдан)',               source:'СНИЛС',       sample:'Иванову Ивану Ивановичу' },
      { token:'PROF_STUDENT_NAME_GENITIVE2', label:'ФИО (род. падеж — чей диплом)',               source:'СНИЛС',       sample:'Иванова Ивана Ивановича' },
      { token:'PROF_STUDENT_EDUCATION',      label:'Образование (Высшее/Среднее и т.д.)',         source:'Диплом',      sample:'Высшее' },
      { token:'PROF_STUDENT_WORKPLACE',      label:'Место работы',                                source:'Заявка',      sample:'ООО «ДЕМО ГРУПП»' },
      { token:'PROF_STUDENT_POSITION',       label:'Должность',                                   source:'Заявка',      sample:'Инженер' },
      { token:'PROF_COURSE_START_DATE',      label:'Дата начала обучения',                        source:'Яндекс-форма',sample:'«01» января 2025' },
      { token:'PROF_COURSE_END_DATE',        label:'Дата окончания обучения',                     source:'Яндекс-форма',sample:'«28» февраля 2025' },
      { token:'PROF_DIPLOMA_NUMBER',         label:'Номер диплома',                               source:'Яндекс-форма',sample:'ДЕМО-000/25' },
      { token:'PROF_PROTOCOL_NUMBER',        label:'Номер протокола',                             source:'Яндекс-форма',sample:'000/2025-ДЕМО' }
    ],
    docs: [
      'Диплом о профессиональной переподготовке (пожарная безопасность)',
      'Приложение к диплому о профессиональной переподготовке',
      'Протокол итоговой аттестации'
    ]
  },

  /* ===== ПАКЕТ 4: Профка ПП ===== */
  prof_pp: {
    name: 'ПАКЕТ 4: Профка ПП',
    fields: [
      { token:'PROFPP_STUDENT_FULL_NAME',      label:'ФИО обучающегося полностью',             source:'СНИЛС',       sample:'Иванов Иван Иванович' },
      { token:'PROFPP_STUDENT_NAME_GENITIVE',  label:'ФИО (дат. падеж — кому выдан)',           source:'СНИЛС',       sample:'Иванову Ивану Ивановичу' },
      { token:'PROFPP_STUDENT_NAME_GENITIVE2', label:'ФИО (род. падеж — чей диплом)',           source:'СНИЛС',       sample:'Иванова Ивана Ивановича' },
      { token:'PROFPP_STUDENT_EDUCATION',      label:'Образование (Высшее/Среднее и т.д.)',     source:'Диплом',      sample:'Высшее' },
      { token:'PROFPP_STUDENT_WORKPLACE',      label:'Место работы',                            source:'Заявка',      sample:'ООО «ДЕМО ГРУПП»' },
      { token:'PROFPP_STUDENT_POSITION',       label:'Должность',                               source:'Заявка',      sample:'Инженер' },
      { token:'PROFPP_COURSE_START_DATE',      label:'Дата начала обучения',                    source:'Яндекс-форма',sample:'«01» января 2025' },
      { token:'PROFPP_COURSE_END_DATE',        label:'Дата окончания обучения',                 source:'Яндекс-форма',sample:'«28» февраля 2025' },
      { token:'PROFPP_DIPLOMA_NUMBER',         label:'Номер диплома',                           source:'Яндекс-форма',sample:'ДЕМО-000/25' },
      { token:'PROFPP_PROTOCOL_NUMBER',        label:'Номер протокола',                         source:'Яндекс-форма',sample:'000/2025-ДЕМО' }
    ],
    docs: [
      'Диплом о профессиональной переподготовке',
      'Приложение к диплому о профессиональной переподготовке',
      'Протокол итоговой аттестации'
    ]
  },

  /* ===== ПАКЕТ 5: УПК 178 ===== */
  upk178: {
    name: 'ПАКЕТ 5: УПК 178',
    fields: [
      { token:'UPK_STUDENT_FULL_NAME',  label:'ФИО обучающегося полностью', source:'СНИЛС',       sample:'Иванов Иван Иванович' },
      { token:'UPK_STUDENT_WORKPLACE',  label:'Место работы',               source:'Заявка',      sample:'ООО «ДЕМО ГРУПП»' },
      { token:'UPK_STUDENT_POSITION',   label:'Должность',                  source:'Заявка',      sample:'Инженер' },
      { token:'UPK_CERTIFICATE_NUMBER', label:'Номер удостоверения',        source:'Яндекс-форма',sample:'ПБ/0000-2025' },
      { token:'UPK_CERTIFICATE_DATE',   label:'Дата удостоверения',         source:'Яндекс-форма',sample:'01.01.2025' },
      { token:'UPK_PROTOCOL_NUMBER',    label:'Номер протокола',            source:'Яндекс-форма',sample:'000/2025-ПБ' }
    ],
    docs: [
      'Удостоверение о повышении квалификации (ПП № 178)',
      'Протокол итоговой аттестации'
    ]
  },

  /* ===== ПАКЕТ 6: УПК МПБ ===== */
  upk_mpb: {
    name: 'ПАКЕТ 6: УПК МПБ',
    fields: [
      { token:'MPB_STUDENT_FULL_NAME',  label:'ФИО обучающегося полностью', source:'СНИЛС',       sample:'Иванов Иван Иванович' },
      { token:'MPB_STUDENT_WORKPLACE',  label:'Место работы',               source:'Заявка',      sample:'ООО «ДЕМО ГРУПП»' },
      { token:'MPB_STUDENT_POSITION',   label:'Должность',                  source:'Заявка',      sample:'Инженер' },
      { token:'MPB_COURSE_NAME',        label:'Название программы обучения', source:'Яндекс-форма',sample:'Меры пожарной безопасности для лиц, на которых возложена трудовая функция по проведению противопожарного инструктажа' },
      { token:'MPB_COURSE_CODE',        label:'Код программы',              source:'Яндекс-форма',sample:'МПБ ПК_00' },
      { token:'MPB_CERTIFICATE_NUMBER', label:'Номер удостоверения',        source:'Яндекс-форма',sample:'МПБ/00-2025' },
      { token:'MPB_CERTIFICATE_DATE',   label:'Дата удостоверения',         source:'Яндекс-форма',sample:'01.01.2025' },
      { token:'MPB_PROTOCOL_NUMBER',    label:'Номер протокола',            source:'Яндекс-форма',sample:'00/2025-МПБ' }
    ],
    docs: [
      'Удостоверение о повышении квалификации (меры пожарной безопасности)',
      'Протокол итоговой аттестации'
    ]
  }

});
