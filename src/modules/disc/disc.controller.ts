import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DiscService } from './disc.service';
import { CreateDiscDto } from './dto/create-disc.dto';
import { UpdateDiscDto } from './dto/update-disc.dto';
import { FilterDiscDto } from './dto/filter-disc.dto';

@Controller('discs')
export class DiscController {
  constructor(private readonly discService: DiscService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateDiscDto) {
    return this.discService.create(dto);
  }

  @Get()
  findAll(@Query() filter: FilterDiscDto) {
    return this.discService.findAll(filter);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.discService.findOne(id);
  }

  @Get(':id/stock')
  async getStock(@Param('id', ParseUUIDPipe) id: string) {
    const stock = await this.discService.getStockFromRedis(id);
    return { discId: id, stock };
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiscDto,
  ) {
    return this.discService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.discService.remove(id);
  }
}
