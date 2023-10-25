const { BlobServiceClient } = require("@azure/storage-blob");
const { WebClient } = require("@slack/web-api");
const util = require ('util');
const request  = require ('request');
const requestPromise = util.promisify(request);

const { ChatCompletionRequestMessageRoleEnum } = require("openai");

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
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
 * @param {string[]} messages 会話の履歴
 * @param {string} question 尋ねるメッセージ
 * @param {object} context Azure Functions のcontext
 * @returns content
 */
const createCompletion = async (messages, question, context) => {
  try
  {
    const data = {
      "messages":messages,
      "question":question
    }
    const API_KEY = 'eHhhYHdYuJ2yUoMFFnafA7emIy3SOvIS';
    const API_URL = 'https://exes-chat-endpoint.ukwest.inference.ml.azure.com/score';
    const MODEL_DEPLOYMENT = 'exes-chat-endpoint-1';
    const headers = {'Content-Type':'application/json', 'Authorization':('Bearer '+ API_KEY), 'azureml-model-deployment': MODEL_DEPLOYMENT };
    const response = await requestPromise(
      {
        method: 'POST',
        url: API_URL,
        headers,
        body: JSON.stringify(data)
      }
    );
    context.log(response.body);

    // エスケープされた Unicode 文字をアンエスケープする
    const unicodeUnescape = function(str) {
      return str.replace(/\\u([a-fA-F0-9]{4})/g, function(matchedString, group1) {
        return String.fromCharCode(parseInt(group1, 16));
      });
    };
    const responseString = response.body;
    const responseJson = JSON.parse(responseString);
    return unicodeUnescape(responseJson.answer);
  }catch(err){
    context.log.error('request failed');
    return err;
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

      // メンションの文字列を除去
      let question = event?.text;
      const match = question.match(/(<@([^>]+)> )/);
      if(match?.index == 0) {
        question = question.substring(match[0].length)
      }

      const openaiResponse = await createCompletion(botMessages, question, context);
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
