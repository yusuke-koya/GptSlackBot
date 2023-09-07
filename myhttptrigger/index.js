const { WebClient } = require("@slack/web-api");
const {
  ChatCompletionRequestMessageRoleEnum,
  Configuration,
  OpenAIApi,
} = require("openai");

const openaiClient = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
    basePath: process.env.OPENAI_API_URL + 'openai/deployments/' + process.env.OPENAI_DEPLOY_NAME,
    baseOptions: {
      headers: {'api-key': process.env.OPENAI_API_KEY},
      params: {
        'api-version': '2023-03-15-preview'
      }
    }
  })
);
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const GPT_BOT_USER_ID = process.env.GPT_BOT_USER_ID;
const CHAT_GPT_SYSTEM_PROMPT = process.env.CHAT_GPT_SYSTEM_PROMPT;
const GPT_THREAD_MAX_COUNT = process.env.GPT_THREAD_MAX_COUNT;

/**
 * Slackへメッセージを投稿する
 * @param {string} channel 投稿先のチャンネル
 * @param {string} text 投稿するメッセージ
 * @param {string} threadTs 投稿先がスレッドの場合の設定
 * @param {object} context Azure Functions のcontext
 */
const postMessage = async (channel, text, threadTs, context) => {
  await slackClient.chat.postMessage({
    channel: channel,
    text: text,
    thread_ts: threadTs,
  });
};

/**
 * ChatGPTからメッセージを受け取る
 * @param {string} messages 尋ねるメッセージ
 * @param {object} context Azure Functions のcontext
 * @returns content
 */
const createCompletion = async (messages, context) => {
  try {
    const response = await openaiClient.createChatCompletion({
      messages: messages,
      max_tokens: 800,
      temperature: 0.7,
      frequency_penalty: 0,
      presence_penalty: 0,
      top_p: 0.95,
    });
    return response.data.choices[0].message.content;
  } catch (err) {
    context.log.error(err);
    return err.response.statusText;
  }
};

// NGワードのチェック
const hasNgWord = (text) => {
  const regex = /うんこ|クソ|アホ|.*\d{3}-?\d{4}.*/;
  return regex.test(text);
}

module.exports = async function (context, req) {
  context.log('1');
  // Ignore retry requests
  if (req.headers["x-slack-retry-num"]) {
    context.log("Ignoring Retry request: " + req.headers["x-slack-retry-num"]);
    context.log(req.body);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "No need to resend" }),
    };
  }
  context.log('2');

  // Response slack challenge requests
  const body = eval(req.body);
  if (body.challenge) {
    context.log("Challenge: " + body.challenge);
    context.res = {
      body: body//.challenge, // body: body にした方が良くないか
    };
    return;
  }
  context.log('3');

  context.log(`user:${body.event.user}, message:${body.event.text}`); // 投稿したユーザのIDとテキスト
//   context.log.warn('警告');
//   context.log.error('エラー');

  const event = body.event;
  const threadTs = event?.thread_ts ?? event?.ts;
  context.log('4');
  if (event?.type === "app_mention") {
    try {
      context.log('5');
      if(hasNgWord(body.event.text)) {
        await postMessage(
          event.channel,
          "不適切な言葉が含まれています。",
          threadTs,
          context
        );
        return;
      }
      context.log('6');

      const threadMessagesResponse = await slackClient.conversations.replies({
        channel: event.channel,
        ts: threadTs,
      });
      context.log('7');
      if (threadMessagesResponse.ok !== true) {
        await postMessage(
          event.channel,
          "[Bot]メッセージの取得に失敗しました。",
          threadTs,
          context
        );
        return;
      }
      context.log('8');
      const botMessages = threadMessagesResponse.messages
        .sort((a, b) => Number(a.ts) - Number(b.ts))
        // .filter(
        //   (message) => {
        //     return message.text.includes(GPT_BOT_USER_ID) || message.user == GPT_BOT_USER_ID // Slack App のメンバーIDに一致するものだけ
        //   }
        // )
        .slice(GPT_THREAD_MAX_COUNT * -1)
        .map((m) => {
          const role = m.bot_id
            ? ChatCompletionRequestMessageRoleEnum.Assistant
            : ChatCompletionRequestMessageRoleEnum.User;
            // context.log(m.text);
          return { role: role, content: m.text.replace(/]+>/g, "") };
        });
      context.log('9');
      if (botMessages.length < 1) {
        await postMessage(
          event.channel,
          "[Bot]質問メッセージが見つかりませんでした。@exa-kun-bot0 を付けて質問してみて下さい。",
          threadTs,
          context
        );
        return;
      }
      context.log('10');
      context.log(botMessages);
      var postMessages = [
        {
          role: ChatCompletionRequestMessageRoleEnum.System,
          content: CHAT_GPT_SYSTEM_PROMPT,
        },
        ...botMessages,
      ];
      context.log('11');
      const openaiResponse = await createCompletion(postMessages, context);
      if (openaiResponse == null || openaiResponse == "") {
        await postMessage(
          event.channel,
          "[Bot]ChatGPTから返信がありませんでした。この症状は、ChatGPTのサーバーの調子が悪い時に起こります。少し待って再度試してみて下さい。",
          threadTs,
          context
        );
        return { statusCode: 200 };
      }
      context.log('12');
    //   context.log(openaiResponse);
      await postMessage(event.channel, openaiResponse, threadTs, context);
      context.log("ChatGPTBot function post message successfully.");
      return { statusCode: 200 };
    } catch (error) {
      context.log(
        await postMessage(
          event.channel,
          `Error happened: ${error}`,
          threadTs,
          context
        )
      );
    }
  }
  context.res = {
    status: 200,
  };
};