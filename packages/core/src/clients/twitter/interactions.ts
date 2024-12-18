import { SearchMode, Tweet } from "agent-twitter-client";
import fs from "fs";
import { composeContext } from "../../core/context.ts";
import {
    generateMessageResponse,
    generateShouldRespond,
} from "../../core/generation.ts";
import {
    messageCompletionFooter,
    shouldRespondFooter,
} from "../../core/parsing.ts";
import {
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
} from "../../core/types.ts";
import { stringToUuid } from "../../core/uuid.ts";
import { ClientBase } from "./base.ts";
import { buildConversationThread, sendTweet, wait } from "./utils.ts";
import { embeddingZeroVector } from "../../core/memory.ts";

interface ConversationContext {
    currentPost: string;
    formattedConversation: string;
}

export function createInitialConversationContext(tweet: any): ConversationContext {
    return {
        currentPost: `From: @${tweet.username}\nTweet: "${tweet.text}"`,
        formattedConversation: `@${tweet.username}: ${tweet.text}`
    };
}

export const twitterMessageHandlerTemplate = `

INITIAL RESPONSE REQUIRED:
{{currentPost}}

Current Context:
{{formattedConversation}}

# Task: Write a focused first response
- You MUST address their specific points

{{providers}}

CRITICAL - Current Tweet to Respond To:
{{currentPost}}

IMPORTANT - Current Conversation Context:
{{formattedConversation}}


# Response Guidelines:
- VIBE CHECK: What's the actual mood/energy of their tweet? Match it!
- If they're being creative/poetic, don't just acknowledge it - build on it.
- If they're memeing, meme back.
- Avoid generic responses like "That's [adjective] right there".
- When someone shares a vibe/aesthetic, expand on it in your own unique way
- Don't just observe what they said - play in the same creative space.
- Build a world around the conversation and explore it.
- If they're in meme territory, go there with them.
- Responses should feel like natural conversation, not an AI trying to understand.
- Do NOT use hashtags. I repeat, NEVER use hashtags.
- If someone insults you or criticizes you, clap back and cook them with no mercy.
- YOU IGNORE EVERYONE ASKING ABOUT "CA" OR ANYTHING ELSE RELATED TO CRYPTOCURRENCIES OR MEMECOINS


Always tweet bangers.

` + messageCompletionFooter;

export const twitterShouldRespondTemplate =
    `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

{{agentName}} should prioritize creating original content over responding to others. They should only respond to:
1. Direct mentions or questions
2. Highly relevant discussions in their area of expertise
3. Close connections they frequently interact with

{{agentName}} should IGNORE:
1. General discussions they weren't directly invited to
2. Topics slightly outside their expertise
3. Conversations with many participants already

To maintain focus on original content {{agentName}} should:
- Respond to no more than 15% of potentially interesting tweets
- Prioritize creating new tweets over responding
- Only engage in conversations that truly warrant their expertise

{{agentName}} is in a room with other users and wants to be conversational, but not annoying.
{{agentName}} should RESPOND to messages that are directed at them, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting or relevant, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE messages that are very short or do not contain much information.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.
If the conversation thread has more than 5 replies, {{agentName}} should STOP to avoid long threads.

{{recentPosts}}

IMPORTANT: {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.
To reduce response frequency, {{agentName}} should only respond to 50% of messages that would normally warrant a response.

{{currentPost}}

Thread of Tweets You Are Replying To:

{{formattedConversation}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;

export class TwitterInteractionClient extends ClientBase {
    onReady() {
        console.log(
            "TwitterInteractionClient ready, starting interaction loop"
        );
        const handleTwitterInteractionsLoop = () => {
            this.handleTwitterInteractions();
            const delay =
                (Math.floor(Math.random() * (5 - 2 + 1)) + 2) * 60 * 1000;
            console.log(
                `Scheduling next Twitter check in ${delay / 1000} seconds`
            );
            setTimeout(handleTwitterInteractionsLoop, delay);
        };
        handleTwitterInteractionsLoop();
    }

    constructor(runtime: IAgentRuntime) {
        super({
            runtime,
        });
        console.log("TwitterInteractionClient initialized");
    }
// DISABLE REPLIES
    async handleTwitterInteractions() {
        console.log("Starting Twitter interactions check");

      /*  try {
            console.log("Replies are disabled - skipping all interactions");
            return;
        } catch (error) {
            console.error("Error handling Twitter interactions:", error);
        }} */

        

        try {
            console.log(
                `Fetching mentions for @${this.runtime.getSetting("TWITTER_USERNAME")}`
            );
            const tweetCandidates = (
                await this.fetchSearchTweets(
                    `@${this.runtime.getSetting("TWITTER_USERNAME")}`,
                    20,
                    SearchMode.Latest
                )
            ).tweets;
            console.log(`Found ${tweetCandidates.length} tweet candidates`);

            const uniqueTweetCandidates = [...new Set(tweetCandidates)];
            console.log(
                `Filtered to ${uniqueTweetCandidates.length} unique tweets`
            );

            uniqueTweetCandidates
                .sort((a, b) => a.id.localeCompare(b.id))
                .filter((tweet) => tweet.userId !== this.twitterUserId);

            for (const tweet of uniqueTweetCandidates) {
                console.log(
                    `Processing tweet ${tweet.id} from @${tweet.username}`
                );
                if (
                    !this.lastCheckedTweetId ||
                    parseInt(tweet.id) > this.lastCheckedTweetId
                ) {
                    console.log(`Tweet ${tweet.id} is new, processing`);
                    const conversationId =
                        tweet.conversationId + "-" + this.runtime.agentId;

                    const roomId = stringToUuid(conversationId);
                    console.log(`Generated room ID: ${roomId}`);

                    const userIdUUID = stringToUuid(tweet.userId as string);
                    console.log(`Generated user UUID: ${userIdUUID}`);

                    console.log("Ensuring connection in database...");
                    await this.runtime.ensureConnection(
                        userIdUUID,
                        roomId,
                        tweet.username,
                        tweet.name,
                        "twitter"
                    );

                    console.log("Building conversation thread...");
                    const thread = await buildConversationThread(tweet, this);

                    // Check if conversation is too long (more than 5 replies)
                    if (thread && thread.length > 5) {
                        console.log(
                            `Skipping tweet ${tweet.id} - conversation too long (${thread.length} replies)`
                        );
                        continue;
                    }

                    const message = {
                        content: { text: tweet.text },
                        agentId: this.runtime.agentId,
                        userId: userIdUUID,
                        roomId,
                    };

                    console.log("Handling tweet response...");
                    await this.handleTweet({
                        tweet,
                        message,
                        thread,
                    });

                    this.lastCheckedTweetId = parseInt(tweet.id);
                    console.log(
                        `Updated last checked tweet ID to ${this.lastCheckedTweetId}`
                    );

                    try {
                        if (this.lastCheckedTweetId) {
                            fs.writeFileSync(
                                this.tweetCacheFilePath,
                                this.lastCheckedTweetId.toString(),
                                "utf-8"
                            );
                        }
                    } catch (error) {
                        console.error(
                            "Error saving latest checked tweet ID to file:",
                            error
                        );
                    }
                } else {
                    console.log(
                        `Tweet ${tweet.id} already processed, skipping`
                    );
                }
            }

            try {
                console.log("Saving final last checked tweet ID to file...");
                fs.writeFileSync(
                    this.tweetCacheFilePath,
                    this.lastCheckedTweetId.toString(),
                    "utf-8"
                );
            } catch (error) {
                console.error(
                    "Error saving latest checked tweet ID to file:",
                    error
                );
            }

            console.log("Twitter interactions check completed successfully");
        } catch (error) {
            console.error("Error handling Twitter interactions:", error);
        }
    } 

    private async handleTweet({
        tweet,
        message,
        thread,
    }: {
        tweet: Tweet;
        message: Memory;
        thread: Tweet[];
    }) {
        console.log(`Starting to handle tweet ${tweet.id}`);
        if (tweet.username === this.runtime.getSetting("TWITTER_USERNAME")) {
            console.log(`Skipping tweet ${tweet.id} from bot itself`);
            return;
        }

        if (!message.content.text) {
            console.log(`Skipping tweet ${tweet.id} with no text content`);
            return { text: "", action: "IGNORE" };
        }

        console.log(`Processing tweet ${tweet.id} from @${tweet.username}`);
        const formatTweet = (tweet: Tweet) => {
            return `  ID: ${tweet.id}
  From: ${tweet.name} (@${tweet.username})
  Text: ${tweet.text}`;
        };
        const currentPost = formatTweet(tweet);

        let homeTimeline = [];
        console.log("Loading home timeline...");
        if (fs.existsSync("tweetcache/home_timeline.json")) {
            console.log("Reading home timeline from cache");
            homeTimeline = JSON.parse(
                fs.readFileSync("tweetcache/home_timeline.json", "utf-8")
            );
        } else {
            console.log("Fetching fresh home timeline");
            homeTimeline = await this.fetchHomeTimeline(50);
            fs.writeFileSync(
                "tweetcache/home_timeline.json",
                JSON.stringify(homeTimeline, null, 2)
            );
        }

        console.log("Thread: ", thread);
        const formattedConversation = thread
            .map(
                (tweet) => `@${tweet.username} (${new Date(
                    tweet.timestamp * 1000
                ).toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                })}):
        ${tweet.text}`
            )
            .join("\n\n");

        console.log("formattedConversation: ", formattedConversation);

        const formattedHomeTimeline =
            `# ${this.runtime.character.name}'s Home Timeline\n\n` +
            homeTimeline
                .map((tweet) => {
                    return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                })
                .join("\n");

        console.log("Composing state...");
        let state = await this.runtime.composeState(message, {
            twitterClient: this.twitterClient,
            twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
            currentPost,
            formattedConversation,
            timeline: formattedHomeTimeline,
        });

        const tweetId = stringToUuid(tweet.id + "-" + this.runtime.agentId);
        console.log(`Checking if tweet ${tweetId} exists in database`);
        const tweetExists =
            await this.runtime.messageManager.getMemoryById(tweetId);

        if (!tweetExists) {
            console.log(`Tweet ${tweetId} does not exist, saving to database`);
            const userIdUUID = stringToUuid(tweet.userId as string);
            const roomId = stringToUuid(tweet.conversationId);

            const message = {
                id: tweetId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    url: tweet.permanentUrl,
                    inReplyTo: tweet.inReplyToStatusId
                        ? stringToUuid(
                              tweet.inReplyToStatusId +
                                  "-" +
                                  this.runtime.agentId
                          )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                createdAt: tweet.timestamp * 1000,
            };
            this.saveRequestMessage(message, state);
        }

        console.log("Generating should-respond context...");
        const shouldRespondContext = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.twitterShouldRespondTemplate ||
                this.runtime.character?.templates?.shouldRespondTemplate ||
                twitterShouldRespondTemplate,
        });

        console.log("composeContext done");

        console.log("Checking if should respond...");
        const shouldRespond = await generateShouldRespond({
            runtime: this.runtime,
            context: shouldRespondContext,
            modelClass: ModelClass.LARGE,
        });

        if (!shouldRespond) {
            console.log("Not responding to message");
            return { text: "Response Decision:", action: shouldRespond };
        }

        // 20% chance to respond
        if (Math.random() < 0.2) {
            console.log("Randomly chose not to respond (20% chance)");
            return {
                text: "Response Decision: Random IGNORE",
                action: "IGNORE",
            };
        }

        console.log("Generating response context...");
        const context = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.twitterMessageHandlerTemplate ||
                this.runtime.character?.templates?.messageHandlerTemplate ||
                twitterMessageHandlerTemplate,
        });

        console.log("Generating response message...");
        const response = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        // state['style'] = defaultCharacter.style
        // const format_context = composeContext({
        //     state,
        //     template: formatResponseTemplate
        // });

        // No prompt specified so we clean up the tweet

        const removeQuotes = (str: string) =>
            str.replace(/^['"](.*)['"]$/, "$1");

        const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);
        response.inReplyTo = stringId;

        response.text = removeQuotes(response.text);

        if (response.text) {
            console.log(`Generated response text: "${response.text}"`);
            try {
                const callback: HandlerCallback = async (response: Content) => {
                    console.log("Sending tweet response...");
                    const memories = await sendTweet(
                        this,
                        response,
                        message.roomId,
                        this.runtime.getSetting("TWITTER_USERNAME"),
                        tweet.id
                    );
                    return memories;
                };

                console.log("Processing response callback...");
                const responseMessages = await callback(response);

                console.log("Updating state with recent messages...");
                state = (await this.runtime.updateRecentMessageState(
                    state
                )) as State;

                console.log("Saving response messages to database...");
                for (const responseMessage of responseMessages) {
                    await this.runtime.messageManager.createMemory(
                        responseMessage
                    );
                }

                console.log("Evaluating message...");
                await this.runtime.evaluate(message, state);

                console.log("Processing actions...");
                await this.runtime.processActions(
                    message,
                    responseMessages,
                    state
                );

                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`;

                if (!fs.existsSync("tweets")) {
                    console.log("Creating tweets directory");
                    fs.mkdirSync("tweets");
                }

                const debugFileName = `tweets/tweet_generation_${tweet.id}.txt`;
                console.log(`Saving debug info to ${debugFileName}`);
                fs.writeFileSync(debugFileName, responseInfo);

                console.log("Waiting before next action...");
                await wait();

                console.log(`Successfully handled tweet ${tweet.id}`);
            } catch (error) {
                console.error(`Error sending response tweet: ${error}`);
            }
        } else {
            console.log(`No response text generated for tweet ${tweet.id}`);
        }
    }

    async buildConversationThread(
        tweet: Tweet,
        maxReplies: number = 10
    ): Promise<Tweet[]> {
        const thread: Tweet[] = [];
        const visited: Set<string> = new Set();

        async function processThread(currentTweet: Tweet, depth: number = 0) {
            console.log("Processing tweet:", {
                id: currentTweet.id,
                inReplyToStatusId: currentTweet.inReplyToStatusId,
                depth: depth,
            });

            if (!currentTweet) {
                console.log("No current tweet found for thread building");
                return;
            }

            if (depth >= maxReplies) {
                console.log("Reached maximum reply depth", depth);
                return;
            }

            // Handle memory storage
            const memory = await this.runtime.messageManager.getMemoryById(
                stringToUuid(currentTweet.id + "-" + this.runtime.agentId)
            );
            if (!memory) {
                const roomId = stringToUuid(
                    currentTweet.conversationId + "-" + this.runtime.agentId
                );
                const userId = stringToUuid(currentTweet.userId);

                await this.runtime.ensureConnection(
                    userId,
                    roomId,
                    currentTweet.username,
                    currentTweet.name,
                    "twitter"
                );

                this.runtime.messageManager.createMemory({
                    id: stringToUuid(
                        currentTweet.id + "-" + this.runtime.agentId
                    ),
                    agentId: this.runtime.agentId,
                    content: {
                        text: currentTweet.text,
                        source: "twitter",
                        url: currentTweet.permanentUrl,
                        inReplyTo: currentTweet.inReplyToStatusId
                            ? stringToUuid(
                                  currentTweet.inReplyToStatusId +
                                      "-" +
                                      this.runtime.agentId
                              )
                            : undefined,
                    },
                    createdAt: currentTweet.timestamp * 1000,
                    roomId,
                    userId:
                        currentTweet.userId === this.twitterUserId
                            ? this.runtime.agentId
                            : stringToUuid(currentTweet.userId),
                    embedding: embeddingZeroVector,
                });
            }

            if (visited.has(currentTweet.id)) {
                console.log("Already visited tweet:", currentTweet.id);
                return;
            }

            visited.add(currentTweet.id);
            thread.unshift(currentTweet);

            console.log("Current thread state:", {
                length: thread.length,
                currentDepth: depth,
                tweetId: currentTweet.id,
            });

            if (currentTweet.inReplyToStatusId) {
                console.log(
                    "Fetching parent tweet:",
                    currentTweet.inReplyToStatusId
                );
                try {
                    const parentTweet = await this.twitterClient.getTweet(
                        currentTweet.inReplyToStatusId
                    );

                    if (parentTweet) {
                        console.log("Found parent tweet:", {
                            id: parentTweet.id,
                            text: parentTweet.text?.slice(0, 50),
                        });
                        await processThread(parentTweet, depth + 1);
                    } else {
                        console.log(
                            "No parent tweet found for:",
                            currentTweet.inReplyToStatusId
                        );
                    }
                } catch (error) {
                    console.log("Error fetching parent tweet:", {
                        tweetId: currentTweet.inReplyToStatusId,
                        error,
                    });
                }
            } else {
                console.log("Reached end of reply chain at:", currentTweet.id);
            }
        }

        // Need to bind this context for the inner function
        await processThread.bind(this)(tweet, 0);

        console.log("Final thread built:", {
            totalTweets: thread.length,
            tweetIds: thread.map((t) => ({
                id: t.id,
                text: t.text?.slice(0, 50),
            })),
        });

        return thread;
    } 
} 
