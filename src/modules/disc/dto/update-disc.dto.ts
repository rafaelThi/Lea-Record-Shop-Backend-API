import { PartialType } from '@nestjs/swagger';
import { CreateDiscDto } from './create-disc.dto';

export class UpdateDiscDto extends PartialType(CreateDiscDto) {}
