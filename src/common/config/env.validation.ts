import { plainToClass, Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, validateSync, Min, isString, IsString, IsNumberString } from 'class-validator';
import { Environment, LogLevel, LogFormat } from './config.interface';

const toNumber =
  ({ defaultValue }) =>
  ({ value }) => {
    if (value === '' || value == null) return defaultValue;
    return Number(value);
  };

export class EnvironmentVariables {
  // @IsEnum(Environment)
  NODE_ENV: Environment = Environment.development;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(toNumber({ defaultValue: 3000 }))
  RELAYER_PORT: number;

  @IsOptional()
  @IsEnum(LogLevel)
  @Transform(({ value }) => value || LogLevel.info)
  LOG_LEVEL: LogLevel;

  @IsOptional()
  @IsEnum(LogFormat)
  @Transform(({ value }) => value || LogFormat.json)
  LOG_FORMAT: LogFormat;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(toNumber({ defaultValue: 5 }))
  GLOBAL_THROTTLE_TTL: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(toNumber({ defaultValue: 100 }))
  GLOBAL_THROTTLE_LIMIT: number;

  @IsString()
  NETWORK_ID: string;

  @IsString()
  PRIVATE_KEY: string;

  @IsString()
  ALCHEMY_API_KEY: string;

  @IsString()
  INFURA_API_KEY: string;

  @IsString()
  MONGO_URL: string;

  @IsNumberString()
  START_BLOCK: number;
  
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(toNumber({ defaultValue: 100 }))
  NUMBER_OF_BLOCKS_TO_PROCESS_PER_CHUNK: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(toNumber({ defaultValue: 100 }))
  RELAYER_SLEEP_AFTER_SUCCESS_EXEC: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(toNumber({ defaultValue: 100 }))
  RELAYER_SLEEP_AFTER_FAIL_EXEC: number;

  @IsString()
  INDEXER_URL: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config);

  const validatorOptions = { skipMissingProperties: false };
  const errors = validateSync(validatedConfig, validatorOptions);

  if (errors.length > 0) {
    console.error(errors.toString());
    process.exit(1);
  }

  return validatedConfig;
}
