import { AutocompleteInteraction, CommandInteraction } from 'discord.js';
import {
  LocalizationMap,
  ApplicationCommandOptionType,
} from 'discord-api-types/v10';
import { SlashasaurusClient } from './SlashasaurusClient';
import {
  MapOptionsToAutocompleteNames,
  CommandOptionsObject,
  MaybePromise,
} from './utilityTypes';
import { ApplicationCommandOptionData, OptionsDataArray } from './OptionTypes';
import { ValidationError } from './CustomErrors';
import {
  SlashCommandAttachmentOption,
  SlashCommandBooleanOption,
  SlashCommandBuilder,
  SlashCommandChannelOption,
  SlashCommandIntegerOption,
  SlashCommandMentionableOption,
  SlashCommandNumberOption,
  SlashCommandRoleOption,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder,
  SlashCommandUserOption,
} from '@discordjs/builders';

type ChatCommandOptions<T extends OptionsDataArray> = {
  name: string;
  nameLocalizations?: LocalizationMap;
  description: string;
  descriptionLocalizations?: LocalizationMap;
  options: T;
  defaultMemberPermissions?: string | number | bigint;
  dmPermission?: boolean;
};

export type CommandGroupMetadata = {
  nameLocalizations?: LocalizationMap;
  description: string;
  descriptionLocalizations?: LocalizationMap;
  defaultMemberPermissions?: string | number | bigint;
  dmPermission?: boolean;
};

export function isCommandGroupMetadata(arg: any): arg is CommandGroupMetadata {
  for (const key in arg) {
    if (key === 'description' && typeof arg[key] !== 'string') return false;
    if (key === 'descriptionLocalizations' && typeof arg[key] !== 'object')
      return false;
    if (
      key === 'defaultMemberPermissions' &&
      !(
        typeof arg[key] === 'number' ||
        typeof arg[key] === 'string' ||
        typeof arg[key] === 'bigint'
      )
    )
      return false;
    if (key === 'dmPermission' && typeof arg[key] !== 'boolean') return false;
  }
  return true;
}

export type CommandRunFunction<T extends OptionsDataArray> = (
  interaction: CommandInteraction,
  client: SlashasaurusClient,
  options: CommandOptionsObject<T>
) => void;

export type AutocompleteFunction<T extends OptionsDataArray> = (
  interaction: AutocompleteInteraction,
  focusedName: MapOptionsToAutocompleteNames<T>,
  focusedValue: string | number,
  client: SlashasaurusClient,
  options: Partial<CommandOptionsObject<T>>
) => void;

type HandlersType<T extends OptionsDataArray> =
  MapOptionsToAutocompleteNames<T> extends never
    ? {
        run: CommandRunFunction<T>;
      }
    : HandlersWithAutoComplete<T>;

type HandlersWithAutoComplete<T extends OptionsDataArray> = {
  run: CommandRunFunction<T>;
  autocomplete: AutocompleteFunction<T>;
};

export function isChatCommand(command: any): command is SlashCommand<any> {
  return command instanceof SlashCommand;
}

export class SlashCommand<T extends OptionsDataArray> {
  commandInfo: ChatCommandOptions<T> & { type: string };
  validatorsMap: Map<
    string,
    (
      interaction: CommandInteraction,
      value: any
    ) => MaybePromise<boolean | string>
  > = new Map();
  transformersMap: Map<string, (value: any) => MaybePromise<any>> = new Map();
  autocompleteMap: Map<
    string,
    (
      interaction: AutocompleteInteraction,
      value: any,
      client: SlashasaurusClient
    ) => MaybePromise<any>
  > = new Map();

  /**
   *
   * @param commandInfo The general info for the command
   * @param handlers
   */
  constructor(commandInfo: ChatCommandOptions<T>, handlers: HandlersType<T>) {
    this.commandInfo = {
      ...commandInfo,
      type: 'CHAT_INPUT',
    };
    commandInfo.options.forEach((option) => {
      if ('validator' in option)
        this.validatorsMap.set(option.name, option.validator);
      if ('transformer' in option)
        this.transformersMap.set(option.name, option.transformer);
      if ('onAutocomplete' in option)
        this.autocompleteMap.set(option.name, option.onAutocomplete);
    });
    this.run = handlers.run;
    if ('autocomplete' in handlers) this.autocomplete = handlers.autocomplete;
  }

  run(
    interaction: CommandInteraction,
    _client: SlashasaurusClient,
    _options: CommandOptionsObject<T>
  ) {
    interaction.reply({
      content: 'This command is not implemented yet',
      ephemeral: true,
    });
  }

  autocomplete(
    interaction: AutocompleteInteraction,
    _focusedName: MapOptionsToAutocompleteNames<T>,
    _focusedValue: string | number,
    _client: SlashasaurusClient,
    _options: Partial<CommandOptionsObject<T>>
  ) {
    interaction.respond([
      {
        name: "This interaction isn't implemented yet",
        value: 'error',
      },
    ]);
  }

  async validateAndTransformOptions(
    interaction: CommandInteraction
  ): Promise<CommandOptionsObject<T> | string[]>;
  async validateAndTransformOptions(
    interaction: AutocompleteInteraction,
    skipRequiredCheck: boolean
  ): Promise<CommandOptionsObject<T>>;
  async validateAndTransformOptions(
    interaction: CommandInteraction | AutocompleteInteraction,
    skipRequiredCheck: boolean = false
  ): Promise<CommandOptionsObject<T> | string[]> {
    const errors: string[] = [];
    const values: Record<string, any> = {};
    for (const option of this.commandInfo.options) {
      // Get the option data
      let value = getDataForType(
        interaction,
        option.type,
        option.name,
        skipRequiredCheck ? false : option.required ?? false
      );

      // If the value is undefined, assign early and continue to skip the rest of the validation and transformation
      if (value === null) {
        values[option.name] = null;
        continue;
      }

      // Check if the option has a validator
      let isValid = true;
      if (
        this.validatorsMap.has(option.name) &&
        interaction instanceof CommandInteraction
      ) {
        // Run the validator
        try {
          const validateResult = await this.validatorsMap.get(option.name)!(
            interaction,
            value
          );
          if (typeof validateResult === 'string') {
            errors.push(validateResult);
            isValid = false;
          }
        } catch (e) {
          if (e instanceof ValidationError) {
            // This threw a validation error, add the message to our errors array
            errors.push(e.message);
          } else {
            // This threw a different error, throw it
            throw e;
          }
        }
      }
      // If the option is invalid, skip it
      if (!isValid) continue;

      // Check if the option has a transformer
      if (this.transformersMap.has(option.name)) {
        // Run the transformer
        value = await this.transformersMap.get(option.name)!(value);
      }

      // Add the value to the values object
      values[option.name] = value;
    }
    if (errors.length > 0) return errors;
    return values as CommandOptionsObject<T>;
  }
}

function getDataForType(
  interaction: CommandInteraction | AutocompleteInteraction,
  type: ApplicationCommandOptionData['type'],
  name: string,
  required: boolean
) {
  switch (type) {
    case 'STRING':
    case ApplicationCommandOptionType.String:
      return interaction.options.getString(name, required);
    case 'INTEGER':
    case ApplicationCommandOptionType.Integer:
      return interaction.options.getInteger(name, required);
    case 'BOOLEAN':
    case ApplicationCommandOptionType.Boolean:
      return interaction.options.getBoolean(name, required);
    case 'USER':
    case ApplicationCommandOptionType.User:
      return (
        interaction.options.getMember(name, required) ??
        interaction.options.getUser(name, required)
      );
    case 'CHANNEL':
    case ApplicationCommandOptionType.Channel:
      return interaction.options.getChannel(name, required);
    case 'ROLE':
    case ApplicationCommandOptionType.Role:
      return interaction.options.getRole(name, required);
    case 'MENTIONABLE':
    case ApplicationCommandOptionType.Mentionable:
      return interaction.options.getMentionable(name, required);
    case 'NUMBER':
    case ApplicationCommandOptionType.Number:
      return interaction.options.getNumber(name, required);
    case 'ATTACHMENT':
    case ApplicationCommandOptionType.Attachment:
      return interaction.options.getAttachment(name, required);
  }
}

export function populateBuilder<
  T extends SlashCommandBuilder | SlashCommandSubcommandBuilder
>(info: ChatCommandOptions<any>, builder: T) {
  builder
    .setName(info.name)
    .setNameLocalizations(info.nameLocalizations ?? null)
    .setDescription(info.description)
    .setDescriptionLocalizations(info.descriptionLocalizations ?? null);
  if (builder instanceof SlashCommandBuilder) {
    builder
      .setDefaultMemberPermissions(info.defaultMemberPermissions)
      .setDMPermission(info.dmPermission);
  }
  info.options.forEach((option: ApplicationCommandOptionData) => {
    switch (option.type) {
      case ApplicationCommandOptionType.String:
      case 'STRING':
        const string = new SlashCommandStringOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false)
          .setAutocomplete(option.autocomplete ?? false);
        if ('choices' in option && option.choices) {
          string.setChoices(
            ...option.choices.map((choice) => ({
              name: choice.name,
              name_localizations: choice.nameLocalizations ?? null,
              value: choice.value as string,
            }))
          );
        }
        builder.addStringOption(string);
        break;
      case ApplicationCommandOptionType.Integer:
      case 'INTEGER':
        const integer = new SlashCommandIntegerOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false)
          .setAutocomplete(option.autocomplete ?? false);
        if ('minValue' in option && option.minValue)
          integer.setMinValue(option.minValue);
        if ('maxValue' in option && option.maxValue)
          integer.setMaxValue(option.maxValue);
        if ('choices' in option && option.choices) {
          integer.setChoices(
            ...option.choices.map((choice) => ({
              name: choice.name,
              name_localizations: choice.nameLocalizations ?? null,
              value: choice.value as number,
            }))
          );
        }
        builder.addIntegerOption(integer);
        break;
      case ApplicationCommandOptionType.Boolean:
      case 'BOOLEAN':
        const boolean = new SlashCommandBooleanOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false);
        builder.addBooleanOption(boolean);
        break;
      case ApplicationCommandOptionType.User:
      case 'USER':
        const user = new SlashCommandUserOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false);
        builder.addUserOption(user);
        break;
      case ApplicationCommandOptionType.Channel:
      case 'CHANNEL':
        const channel = new SlashCommandChannelOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false);
        if (option.channelTypes) {
          channel.addChannelTypes(...option.channelTypes);
        }
        builder.addChannelOption(channel);
        break;
      case ApplicationCommandOptionType.Role:
      case 'ROLE':
        const role = new SlashCommandRoleOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false);
        builder.addRoleOption(role);
        break;
      case ApplicationCommandOptionType.Mentionable:
      case 'MENTIONABLE':
        const mentionable = new SlashCommandMentionableOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false);
        builder.addMentionableOption(mentionable);
        break;
      case ApplicationCommandOptionType.Number:
      case 'NUMBER':
        const number = new SlashCommandNumberOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false)
          .setAutocomplete(option.autocomplete ?? false);
        if ('minValue' in option && option.minValue)
          number.setMinValue(option.minValue);
        if ('maxValue' in option && option.maxValue)
          number.setMaxValue(option.maxValue);
        if ('choices' in option && option.choices) {
          number.setChoices(
            ...option.choices.map((choice) => ({
              name: choice.name,
              name_localizations: choice.nameLocalizations ?? null,
              value: choice.value as number,
            }))
          );
        }
        builder.addNumberOption(number);
        break;
      case ApplicationCommandOptionType.Attachment:
      case 'ATTACHMENT':
        const attachment = new SlashCommandAttachmentOption()
          .setName(option.name)
          .setNameLocalizations(option.nameLocalizations ?? null)
          .setDescription(option.description)
          .setDescriptionLocalizations(option.descriptionLocalizations ?? null)
          .setRequired(option.required ?? false);
        builder.addAttachmentOption(attachment);
        break;
    }
  });
  return builder;
}
