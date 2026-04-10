import { IsEnum, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { DiscStyle } from '../enums/disc-style.enum';

export class CreateDiscDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  artist: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  releaseYear: number;

  @IsEnum(DiscStyle)
  style: DiscStyle;

  @IsInt()
  @Min(0)
  quantity: number;
}
