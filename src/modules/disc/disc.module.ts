import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Disc } from './entities/disc.entity';
import { DiscService } from './disc.service';
import { DiscController } from './disc.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Disc])],
  controllers: [DiscController],
  providers: [DiscService],
  exports: [DiscService],
})
export class DiscModule {}
