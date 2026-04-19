Как подключить модульные пресеты

1) Положи файлы:
   - content.js (обновлённый)
   - presets/local_master.js
   - presets/global_master.js

2) В manifest.json добавь файлы пресетов в content_scripts.js СРАЗУ ПОСЛЕ content.js.
   Пример:

   "content_scripts": [{
     "matches": ["http://*/*"],
     "js": [
       "content.js",
       "presets/local_master.js",
       "presets/global_master.js"
     ],
     "run_at": "document_end"
   }]

3) Перезагрузи расширение в chrome://extensions (Reload).

4) Добавление нового пресета:
   - Создай новый файл presets/my_preset.js по шаблону ниже
   - Добавь его в manifest.json рядом с другими пресетами
   - Reload

Шаблон файла пресета:

(function(){
  if(!window.__KCS_REGISTER_PRESET__) return;
  window.__KCS_REGISTER_PRESET__({
    id: "my_preset_id",
    title: "Название",
    icon: "✨",
    order: 100,
    tags: ["tag1","tag2"],
    description: "Короткое описание",
    render: (ctx) => {
      const { el, mkInp, field, API, CFG } = ctx;
      const l = ctx.log;
      // ... UI + логика ...
      return el("div",{class:"kcs_card"}, el("div",{class:"kcs_card_head"},"Название"), ...);
    }
  });
})();

