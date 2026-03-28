(function(){
  if(!window.__KCS_REGISTER_PRESET__) return;

  const COMMENTS_URL = "https://npekpacho.ru/kim/#respond";

  window.__KCS_REGISTER_PRESET__({
    id: "suggest_preset",
    title: "Предложить пресет :) ",
    icon: "➕",
    order: 99,
    tags: ["идея", "обратная связь", "предложение", "новый пресет"],
    description: "Короткая инструкция для тех, кто хочет предложить новый пресет или доработку существующего.",
    render: (ctx) => {
      const { el } = ctx;

      const openComments = () => {
        try {
          window.open(COMMENTS_URL, "_blank", "noopener,noreferrer");
        } catch(e) {
          location.href = COMMENTS_URL;
        }
      };

      const copyTemplate = async () => {
        const text = [
          "Хочу пресет:",
          "",
          "1. Что должно делать управление:",
          "2. Что является триггером: кнопка, датчик, вход, выход, таймер, событие Tuya:",
          "3. Что должно происходить по шагам:",
          "4. Какие нужны задержки, условия, исключения:",
          "5. Какие DI/DO уже заняты или есть важные ограничения:",
          "6. Какую задачу это решает на практике:"
        ].join("\n");

        try {
          await navigator.clipboard.writeText(text);
          alert("Шаблон скопирован. Можно вставить его в комментарий.");
        } catch(e) {
          alert("Не удалось скопировать шаблон автоматически. Ниже есть готовый пример текста.");
        }
      };

      const exampleBox = el("div", {
        style: "margin-top:10px;padding:10px 12px;background:#f8f9fb;border:1px solid #e6e8ef;border-radius:10px;font-size:12px;line-height:1.45;white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;"
      }, [
        "Хочу пресет:",
        "",
        "1. Что должно делать управление:",
        "Например: по долгому нажатию выключать весь свет в комнате.",
        "",
        "2. Что является триггером:",
        "Например: DI 7, беспроводной датчик Tuya или включение определённого DO.",
        "",
        "3. Что должно происходить по шагам:",
        "Например: задержка 10 секунд -> включить вентилятор -> через 3 минуты выключить.",
        "",
        "4. Какие нужны условия и исключения:",
        "Например: не трогать DO 1 и DO 2, работать только когда охрана включена.",
        "",
        "5. Какие DI/DO уже заняты:",
        "Например: DO 5 это свет, DO 6 это вентилятор.",
        "",
        "6. Что это решает:",
        "Например: автоматизирует рутину, уменьшает число лишних нажатий и делает сценарий понятным семье."
      ].join("\n"));

      const card = el("div", {class:"kcs_card"},
        el("div", {class:"kcs_card_head"}, "Предложить пресет :)"),
        el("div", {class:"kcs_help", style:"margin-bottom:10px"},
          "Есть идея нового пресета или хочется доработать существующий? Отлично. " +
          "Опиши задачу простыми словами, а не только набором DI, DO и страданий по автоматике. " +
          "Чем понятнее сценарий, тем выше шанс быстро собрать нормальную реализацию."
        ),

        el("div", {style:"font-weight:600;margin:10px 0 6px"}, "Что полезно написать:"),
        el("ol", {style:"margin:0 0 10px 18px;padding:0;line-height:1.45;font-size:13px"},
          el("li", {}, "Что именно должен делать пресет."),
          el("li", {}, "Что запускает сценарий: кнопка, вход, выход, датчик, таймер, событие Tuya."),
          el("li", {}, "Что должно происходить по шагам и в каком порядке."),
          el("li", {}, "Какие нужны задержки, условия, блокировки и исключения."),
          el("li", {}, "Какие входы и выходы уже заняты, если это важно."),
          el("li", {}, "Какую реальную задачу решает этот сценарий.")
        ),

        el("div", {class:"kcs_help"},
          "Зачем это нужно: по хорошему описанию проще понять логику, заметить подводные камни и собрать пресет так, чтобы он был полезен не только автору идеи, но и другим пользователям."
        ),

        el("div", {style:"font-weight:600;margin:12px 0 6px"}, "Готовый шаблон комментария:"),
        exampleBox,

        el("div", {class:"kcs_actions", style:"margin-top:12px"},
          el("button", {class:"kcs_btn primary", onclick: openComments}, "Оставить сообщение"),
          el("button", {class:"kcs_btn", onclick: copyTemplate}, "Скопировать шаблон")
        ),

        el("div", {class:"kcs_help", style:"margin-top:10px"},
          "Почитай и другие комментарии: возможно, похожую задачу уже предлагали. " +
          "И оставь свою идею через форму комментария: "
        ),
        el("a", {
          href: COMMENTS_URL,
          target: "_blank",
          rel: "noopener noreferrer",
          style: "display:inline-block;margin-top:4px;color:#0b57d0;text-decoration:underline;word-break:break-all;font-size:12px;"
        }, COMMENTS_URL)
      );

      return card;
    }
  });
})();
