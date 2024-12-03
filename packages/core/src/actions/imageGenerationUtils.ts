import { Buffer } from "buffer";
import Together from "together-ai";
import { IAgentRuntime } from "../core/types.ts";
import { getImageGenModel, ImageGenModel } from "../core/imageGenModels.ts";
import OpenAI from "openai";
import { elizaLogger } from "../index";
import { generateText } from "../core/generation.ts";
import { ModelClass } from "../core/types.ts";
import Replicate from "replicate";


export const imagePromptTemplate = `# Task: Enhance the image generation prompt
Your task is to enhance the user's request into a detailed prompt that will generate the best possible image.

# Instructions
- Focus on artistic style, mood, lighting, composition and important details
- Keep the final prompt under 200 characters
- If the request is to "generate anything", you have creative control
- Only respond with the enhanced prompt text, no other commentary

Original request: {{prompt}}

Enhanced prompt:`;

export const enhancePrompt = async (
    originalPrompt: string,
    runtime: IAgentRuntime
): Promise<string> => {
    if (!runtime.llamaService) {
        elizaLogger.log("No llamaService available, using original prompt");
        return originalPrompt;
    }

    try {
        const context = `# Task: Enhance the image generation prompt
Your task is to enhance the user's request into a detailed prompt that will generate the best possible image.

# Instructions
- Focus on artistic style, mood, lighting, composition and important details
- Keep the final prompt under 200 characters
- If the request is to "generate anything", you have creative control
- Only respond with the enhanced prompt text, no other commentary

Original request: ${originalPrompt}

Enhanced prompt:`;

        elizaLogger.log("Sending context to llama:", context);
        
        const promptResponse = await generateText({
            runtime,
            context,
            modelClass: ModelClass.LARGE,
        });

        if (promptResponse?.trim()) {
            elizaLogger.log("Successfully enhanced prompt to:", promptResponse);
            return promptResponse.trim();
        }
    } catch (error) {
        elizaLogger.error("Prompt enhancement failed:", error);
    }

    elizaLogger.log("Using original prompt due to enhancement failure");
    return originalPrompt;
};

export const generateImage = async (
    data: {
        prompt: string;
        width: number;
        height: number;
        count?: number;
    },
    runtime: IAgentRuntime
): Promise<{
    success: boolean;
    data?: string[];
    error?: any;
}> => {
    try {
        const enhancedPrompt = await enhancePrompt(data.prompt, runtime);
        elizaLogger.log("Using enhanced prompt for generation:", enhancedPrompt);

        // Use Replicate if configured
        if (runtime.imageGenModel === ImageGenModel.Replicate) {
            elizaLogger.log("Using Replicate for image generation");
            return generateReplicateImage({
                ...data,
                prompt: enhancedPrompt
            }, runtime);
        }

        // Fallback to other providers if needed
        elizaLogger.error("No valid image generation model configured");
        return { success: false, error: "No valid image generation model configured" };
    } catch (error) {
        elizaLogger.error("Image generation failed:", error);
        return { success: false, error };
    }
};

export const generateCaption = async (
    data: { imageUrl: string },
    runtime: IAgentRuntime
): Promise<{
    title: string;
    description: string;
}> => {
    const { imageUrl } = data;
    const resp = await runtime.imageDescriptionService.describeImage(imageUrl);
    return {
        title: resp.title.trim(),
        description: resp.description.trim(),
    };
};

export const generateReplicateImage = async (
    data: {
        prompt: string;
        width: number;
        height: number;
        count?: number;
    },
    runtime: IAgentRuntime
): Promise<{
    success: boolean;
    data?: string[];
    error?: any;
}> => {
    try {
        const replicate = new Replicate({
            auth: runtime.getSetting("REPLICATE_API_TOKEN"),
        });

        const output = await replicate.run(
            "0xnearzero/nearzeroimg:4fa56a2c08d914275fb6e0801807aa88670f06f1a7a79dac645c01762c0d83c7",
            {
                input: {
                    model: "dev",
                    prompt: data.prompt,
                    num_outputs: data.count || 1,
                    output_format: "png",
                    guidance_scale: 3,
                    output_quality: 80,
                    prompt_strength: 0.8,
                    extra_lora_scale: 1,
                    num_inference_steps: 28,
                    megapixels: "1",
                    aspect_ratio: "1:1",
                    go_fast: false,
                    lora_scale: 1,
                }
            }
        );

        if (Array.isArray(output)) {
            // Fetch each image URL and convert to base64
            const base64Images = await Promise.all(
                output.map(async (url) => {
                    const response = await fetch(url);
                    const buffer = await response.arrayBuffer();
                    return `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`;
                })
            );
            
            return {
                success: true,
                data: base64Images
            };
        }

        return {
            success: false,
            error: "Invalid output from Replicate"
        };
    } catch (error) {
        elizaLogger.error("Replicate image generation failed:", error);
        return { success: false, error };
    }
};