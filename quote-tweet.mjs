import { TwitterPostClient } from '../core/src/clients/twitter/post.js';
import { Runtime } from '../core/src/core/runtime.js';

let initializationInProgress = false;
let clientInitialized = false;

async function initializeClient(runtime) {
    if (initializationInProgress) {
        console.log("Initialization already in progress, waiting...");
        while (initializationInProgress) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return;
    }
    
    if (clientInitialized) {
        return;
    }

    try {
        initializationInProgress = true;
        console.log("Starting Twitter client initialization...");
        const client = new TwitterPostClient({ runtime });
        await client.init();
        clientInitialized = true;
        return client;
    } finally {
        initializationInProgress = false;
    }
}

async function quoteTweet(tweetId) {
    console.log(`\n=== Starting Quote Tweet Process ===`);
    console.log(`Target Tweet ID: ${tweetId}\n`);

    const runtime = new Runtime();
    await runtime.init();
    
    const client = await initializeClient(runtime);
    
    try {
        // Verify tweet exists
        console.log("Fetching target tweet...");
        const tweet = await client.getTweet(tweetId);
        
        if (!tweet) {
            console.error(`❌ Tweet with ID ${tweetId} not found`);
            process.exit(1);
        }

        console.log(`\n✓ Found tweet:`);
        console.log(`From: @${tweet.username}`);
        console.log(`Text: ${tweet.text}\n`);

        // Create conversation context
        const conversationContext = {
            currentPost: `QUOTE TWEET REQUIRED:
                From: @${tweet.username}
                Tweet: "${tweet.text}"

                Your quote must:
                - Directly reference the content above
                - Add valuable context or insight
                - Stay focused on their exact topic
                - Not introduce unrelated points`,
            formattedConversation: `@${tweet.username}: ${tweet.text}`
        };

        console.log("Generating quote content...");
        
        // Generate the quote content
        const tweetContent = await client.generateTweetContent(
            {
                isFirstResponse: true,
                currentPost: conversationContext.currentPost,
                formattedConversation: conversationContext.formattedConversation
            },
            {
                template: client.runtime.character.templates?.twitterMessageHandlerTemplate,
                forceResponse: true
            }
        );

        if (!tweetContent) {
            console.error("❌ Failed to generate quote content");
            process.exit(1);
        }

        console.log(`\n✓ Generated quote content:`, tweetContent);

        // Send the quote tweet
        console.log("\nSending quote tweet...");
        const result = await client.requestQueue.add(
            async () => await client.twitterClient.sendTweet(
                tweetContent,
                undefined,
                [],
                tweetId
            )
        );

        console.log("\n✓ Quote tweet posted successfully!");
        console.log("Result:", result);
        return result;

    } catch (error) {
        console.error("\n❌ Error during quote tweet process:", error);
        throw error;
    }
}

// Main execution
const tweetId = process.argv[2];
if (!tweetId) {
    console.error("❌ Please provide a tweet ID");
    process.exit(1);
}

quoteTweet(tweetId)
    .then(() => {
        console.log("\n=== Quote Tweet Process Completed ===");
        process.exit(0);
    })
    .catch(error => {
        console.error("\n❌ Failed to complete quote tweet:", error);
        process.exit(1);
    });