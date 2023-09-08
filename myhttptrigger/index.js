const { BlobServiceClient } = require("@azure/storage-blob");
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

module.exports = async function (context, req) {
  // Ignore retry requests
  if (req.headers["x-slack-retry-num"]) {
    context.log("Ignoring Retry request: " + req.headers["x-slack-retry-num"]);
    context.log(req.body);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "No need to resend" }),
    };
  }

  // Response slack challenge requests
  const body = eval(req.body);
  if (body.challenge) {
    context.log("Challenge: " + body.challenge);
    context.res = {
      body: body//.challenge, // body: body にした方が良くないか
    };
    return;
  }

//   context.log.warn('警告');
//   context.log.error('エラー');

  const event = body.event;
  context.log(`user:${event?.user}, message:${event?.text}`); // 投稿したユーザのIDとテキスト
  const threadTs = event?.thread_ts ?? event?.ts;
  if (event?.type === "app_mention") {
    try {
      const ngText = await hasNgWord(event?.text);
      if(ngText) {
        await postMessage(
          event.channel,
          "不適切な言葉が含まれています。",
          threadTs,
          context
        );
        return;
      }

      const threadMessagesResponse = await slackClient.conversations.replies({
        channel: event.channel,
        ts: threadTs,
      });
      if (threadMessagesResponse.ok !== true) {
        await postMessage(
          event.channel,
          "[Bot]メッセージの取得に失敗しました。",
          threadTs,
          context
        );
        return;
      }
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
      if (botMessages.length < 1) {
        await postMessage(
          event.channel,
          "[Bot]質問メッセージが見つかりませんでした。@exa-kun-bot0 を付けて質問してみて下さい。",
          threadTs,
          context
        );
        return;
      }
      context.log(botMessages);
      var postMessages = [
        {
          role: ChatCompletionRequestMessageRoleEnum.System,
          content: CHAT_GPT_SYSTEM_PROMPT,
        },
        ...botMessages,
      ];
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



async function hasNgWord(text) {
  try {
    console.log("Azure Blob storage v12 - JavaScript quickstart sample");

    // Quick start code goes here
    const AZURE_STORAGE_CONNECTION_STRING = 
    process.env.AZURE_STORAGE_CONNECTION_STRING; // アクセスキーのストレージ接続文字列
  
    if (!AZURE_STORAGE_CONNECTION_STRING) {
        throw Error('Azure Storage Connection string not found');
    }
    
    // Create the BlobServiceClient object with connection string
    const blobServiceClient = BlobServiceClient.fromConnectionString(
        AZURE_STORAGE_CONNECTION_STRING
    );


    // Create a unique name for the container
    const containerName = 'ngwordcontainer';

    // Get a reference to a container
    const containerClient = blobServiceClient.getContainerClient(containerName);


    // downloadBlobToString(containerClient, 'test.txt');
    const ngWordStr = await downloadBlobToString(containerClient, 'ngwords.txt');
    const ngWordArray = ngWordStr.split('\n');
    for(let i in ngWordArray) {
      regex = new RegExp(ngWordArray[i].trim(), 'i');
      if(regex.test(text)) {
        return true;
      }
    }
    return false;

    async function downloadBlobToString(containerClient, blobName) {
        const blobClient = containerClient.getBlobClient(blobName);
        const downloadResponse = await blobClient.download();
        const downloaded = await streamToBuffer(downloadResponse.readableStreamBody);
        return downloaded.toString();
    }
    
    async function streamToBuffer(readableStream) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            readableStream.on('data', (data) => {
                chunks.push(data instanceof Buffer ? data : Buffer.from(data));
            });
            readableStream.on('end', () => {
                resolve(Buffer.concat(chunks));
            });
            readableStream.on('error', reject);
        });
    }
    
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}
