export enum ImageGenModel {
    TogetherAI = "TogetherAI",
    Dalle = "Dalle",
    Replicate = "replicate"
}

export const imageGenModels = {
    [ImageGenModel.TogetherAI]: {
        steps: 4,
        subModel: "black-forest-labs/FLUX.1-schnell",
    },
    [ImageGenModel.Dalle]: {
        steps: 0,
        subModel: "dall-e-3",
    },
    [ImageGenModel.Replicate]: {
        steps: 0,
        subModel: "0xnearzero/nearzeroimg:4fa56a2c08d914275fb6e0801807aa88670f06f1a7a79dac645c01762c0d83c7",
    },
};

export const getImageGenModel = (model: ImageGenModel) => {
    switch (model) {
      case ImageGenModel.Replicate:
        return {
          steps: 28,
          subModel: "0xnearzero/nearzeroimg:4fa56a2c08d914275fb6e0801807aa88670f06f1a7a79dac645c01762c0d83c7"
        };
      // ... other cases
    }
  };
